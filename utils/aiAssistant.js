// Reusable AI assistant core: tool registry + tool-calling chat loop over OpenAI.
// Kept generic (no Express req/res) so it can be extracted into a standalone package later.
const https = require('https');
const Lead = require('../models/Lead');
const Car = require('../models/Car');
const Blog = require('../models/Blog');
const PageView = require('../models/PageView');

const NON_CLOSED_STATUSES = ['won', 'lost', 'archived'];

async function openaiChatCompletion(body, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const apiKey = (
      process.env.OPENAI_API_KEY
      || process.env.OPENAI_SECRET_KEY
      || process.env.OPENAI_KEY
      || ''
    ).trim();

    if (!apiKey) {
      return reject(new Error('Missing OpenAI key. Set OPENAI_API_KEY (or OPENAI_SECRET_KEY).'));
    }

    const requestBody = JSON.stringify(body);
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        Authorization: `Bearer ${apiKey}`
      },
      timeout: timeoutMs
    };

    const req = https.request(options, (res) => {
      let buffer = '';
      res.on('data', chunk => buffer += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`OpenAI error ${res.statusCode}: ${buffer}`));
        }
        try {
          resolve(JSON.parse(buffer));
        } catch (err) {
          reject(new Error('Failed to parse OpenAI response'));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error(`OpenAI request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

// ---------------------- TOOL REGISTRY ----------------------
// Each tool: OpenAI function schema + a handler that performs the actual query/action.
// Write actions return { requiresConfirmation: true } instead of applying the change directly.
const TOOLS = [
  {
    schema: {
      type: 'function',
      function: {
        name: 'getMetrics',
        description: 'Get headline dashboard metrics: total leads, cars, blogs, page views, and follow-up counts.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    handler: async () => {
      const today = new Date();
      const thisWeek = new Date();
      thisWeek.setDate(thisWeek.getDate() + 7);

      const [totalLeads, totalCars, totalBlogs, totalPageViews, followUpNeeded, dueThisWeek, newLeads, noNotes] = await Promise.all([
        Lead.countDocuments(),
        Car.countDocuments(),
        Blog.countDocuments(),
        PageView.countDocuments(),
        Lead.countDocuments({ status: { $nin: NON_CLOSED_STATUSES }, followUpAt: { $ne: null, $lte: today } }),
        Lead.countDocuments({ status: { $nin: NON_CLOSED_STATUSES }, followUpAt: { $ne: null, $gte: today, $lte: thisWeek } }),
        Lead.countDocuments({ status: 'new' }),
        Lead.countDocuments({ notes: { $exists: true, $in: ['', null] } })
      ]);

      return { totalLeads, totalCars, totalBlogs, totalPageViews, followUpNeeded, dueThisWeek, newLeads, noNotes };
    }
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'searchLeads',
        description: 'Search leads by status, a text match on name/email/car, and/or a follow-up due date cutoff.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'in progress', 'won', 'lost', 'archived'] },
            q: { type: 'string', description: 'Free text to match against name, email, or car' },
            followUpBefore: { type: 'string', description: 'ISO date string; only leads with followUpAt on or before this date' },
            limit: { type: 'number', description: 'Max results, default 10, max 25' }
          },
          additionalProperties: false
        }
      }
    },
    handler: async ({ status, q, followUpBefore, limit } = {}) => {
      const query = {};
      if (status) query.status = status;
      if (followUpBefore) {
        const cutoff = new Date(followUpBefore);
        if (!isNaN(cutoff)) query.followUpAt = { $ne: null, $lte: cutoff };
      }
      if (q) {
        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [{ name: re }, { email: re }, { car: re }];
      }
      const cap = Math.min(Math.max(Number(limit) || 10, 1), 25);
      const leads = await Lead.find(query).sort({ createdAt: -1 }).limit(cap).lean();
      return leads.map(l => ({
        id: String(l._id),
        name: l.name,
        email: l.email,
        car: l.car,
        status: l.status,
        followUpAt: l.followUpAt,
        notes: l.notes || ''
      }));
    }
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'getFollowUpQueue',
        description: 'Get leads due for follow-up within the next 7 days, soonest first.',
        parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false }
      }
    },
    handler: async ({ limit } = {}) => {
      const cap = Math.min(Math.max(Number(limit) || 5, 1), 25);
      const thisWeek = new Date();
      thisWeek.setDate(thisWeek.getDate() + 7);
      const leads = await Lead.find({
        status: { $nin: NON_CLOSED_STATUSES },
        followUpAt: { $ne: null, $lte: thisWeek }
      }).sort({ followUpAt: 1 }).limit(cap).lean();
      return leads.map(l => ({ id: String(l._id), name: l.name, car: l.car, status: l.status, followUpAt: l.followUpAt }));
    }
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'getTopPages',
        description: 'Get the most-viewed pages over the last 7 days.',
        parameters: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false }
      }
    },
    handler: async ({ limit } = {}) => {
      const cap = Math.min(Math.max(Number(limit) || 5, 1), 25);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      const rows = await PageView.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: cap }
      ]);
      return rows.map(r => ({ path: r._id, count: r.count }));
    }
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'updateLeadStatus',
        description: 'Propose changing a lead\'s status. This does NOT apply the change directly — it returns a confirmation request for the admin to approve.',
        parameters: {
          type: 'object',
          properties: {
            leadId: { type: 'string', description: 'The lead\'s Mongo _id' },
            status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'in progress', 'won', 'lost', 'archived'] }
          },
          required: ['leadId', 'status'],
          additionalProperties: false
        }
      }
    },
    handler: async ({ leadId, status } = {}) => {
      const lead = await Lead.findById(leadId).lean();
      if (!lead) return { error: 'Lead not found' };
      return {
        requiresConfirmation: true,
        action: 'updateLeadStatus',
        args: { leadId, status },
        summary: `Change ${lead.name}'s status from "${lead.status}" to "${status}"`
      };
    }
  }
];

const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.schema.function.name, t]));

// Actually applies a write action once the admin has confirmed it.
async function applyConfirmedAction(action, args) {
  if (action === 'updateLeadStatus') {
    const { leadId, status } = args || {};
    const lead = await Lead.findByIdAndUpdate(leadId, { status }, { new: true }).lean();
    if (!lead) throw new Error('Lead not found');
    return { ok: true, leadId, status: lead.status };
  }
  throw new Error(`Unknown action: ${action}`);
}

const SYSTEM_PROMPT = `You are the admin assistant for Auto Galleria, a UK used car dealership. You help the admin understand leads, cars, blog posts, and site traffic, and can propose lead status changes (never apply them directly). Use the available tools to fetch real data instead of guessing. Be concise and concrete — use numbers and names from tool results. When a tool result has "requiresConfirmation": true, tell the admin what you're proposing and that it needs their confirmation; do not claim the change has been made.`;

async function runAssistant(message, history = []) {
  const modelName = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message }
  ];

  let pendingAction = null;

  for (let round = 0; round < 4; round++) {
    const response = await openaiChatCompletion({
      model: modelName,
      messages,
      tools: TOOLS.map(t => t.schema),
      temperature: 0.3,
      max_tokens: 500
    });

    const choice = response.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error('No response from AI');

    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) {
      return { reply: msg.content || '', pendingAction };
    }

    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      const tool = TOOLS_BY_NAME[call.function.name];
      let result;
      if (!tool) {
        result = { error: `Unknown tool: ${call.function.name}` };
      } else {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* leave empty */ }
        try {
          result = await tool.handler(args);
          if (result && result.requiresConfirmation) pendingAction = result;
        } catch (err) {
          result = { error: err.message };
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return { reply: 'I had trouble completing that — please try rephrasing your question.', pendingAction };
}

module.exports = { runAssistant, applyConfirmedAction };
