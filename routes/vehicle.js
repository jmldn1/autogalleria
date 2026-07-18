require('dotenv').config();

const express = require("express");
const router = express.Router();
const nodemailer = require('nodemailer');
const Lead = require("../models/Lead");

const DVLA_API_KEY = process.env.DVLA_API_KEY;
const MOT_API_KEY = process.env.MOT_API_KEY;
const DVSA_TENANT_ID = process.env.DVSA_TENANT_ID;
const DVSA_CLIENT_ID = process.env.DVSA_CLIENT_ID;
const DVSA_CLIENT_SECRET = process.env.DVSA_CLIENT_SECRET;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;
const GMAIL_TO = process.env.GMAIL_TO;

const DVLA_URL =
  "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";

const MOT_URL =
  "https://history.mot.api.gov.uk/v1/trade/vehicles/registration/";

const REQUEST_TIMEOUT_MS =
  Number(process.env.REQUEST_TIMEOUT_MS) || 10000;

const motAccessTokenCache = {
  token: null,
  expiresAt: 0,
};

const missingEnv = [
  { name: 'DVLA_API_KEY', value: DVLA_API_KEY },
  { name: 'MOT_API_KEY', value: MOT_API_KEY },
  { name: 'DVSA_TENANT_ID', value: DVSA_TENANT_ID },
  { name: 'DVSA_CLIENT_ID', value: DVSA_CLIENT_ID },
  { name: 'DVSA_CLIENT_SECRET', value: DVSA_CLIENT_SECRET },
  { name: 'GMAIL_USER', value: GMAIL_USER },
  { name: 'GMAIL_PASS', value: GMAIL_PASS },
  { name: 'GMAIL_TO', value: GMAIL_TO },
].filter(env => !env.value).map(env => env.name);

if (missingEnv.length) {
  throw new Error(`Missing required env vars for vehicle route: ${missingEnv.join(', ')}`);
}

console.log("Vehicle route environment validated.");



// ==========================
// HELPER
// ==========================

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}


// ==========================
// MANUAL RESPONSE
// ==========================

function manualResponse(message) {
  return {
    year: null,
    make: null,
    model: null,
    color: null,
    fuelType: null,
    engineSize: null,
    motStatus: null,
    motExpiry: null,
    source: 'manual',
    message,
  };
}


// ==========================
// GET MOT ACCESS TOKEN
// ==========================

async function getMotAccessToken() {

  if (
    motAccessTokenCache.token &&
    Date.now() < motAccessTokenCache.expiresAt
  ) {
    return motAccessTokenCache.token;
  }

  try {

    const tokenUrl =
      `https://login.microsoftonline.com/${DVSA_TENANT_ID}/oauth2/v2.0/token`;

    const params = new URLSearchParams();

    params.append(
      "grant_type",
      "client_credentials"
    );

    params.append(
      "client_id",
      DVSA_CLIENT_ID
    );

    params.append(
      "client_secret",
      DVSA_CLIENT_SECRET
    );

    params.append(
      "scope",
      "https://tapi.dvsa.gov.uk/.default"
    );

    const response = await fetchWithTimeout(
      tokenUrl,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: params
      },
      REQUEST_TIMEOUT_MS
    );

    const data = await response.json();

    console.log(
      "TOKEN STATUS:",
      response.status
    );

    if (!response.ok) {

      console.log(
        "TOKEN ERROR:",
        data
      );

      return null;
    }

    const expiresIn = Number(data.expires_in) || 3600;
    motAccessTokenCache.token = data.access_token;
    motAccessTokenCache.expiresAt = Date.now() + (expiresIn - 60) * 1000;

    return motAccessTokenCache.token;

  } catch(err) {

    console.error(
      "Token fetch error:",
      err
    );

    return null;
  }
}



// ==========================
// GET MOT VEHICLE DATA
// ==========================

async function getMotVehicleData(reg) {
  try {
    const accessToken = await getMotAccessToken();

    if (!accessToken) {
      console.log("No MOT access token");
      return null;
    }

    const response = await fetchWithTimeout(
      `${MOT_URL}${reg}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-API-Key": MOT_API_KEY,
          "Accept": "application/json"
        }
      },
      REQUEST_TIMEOUT_MS
    );

    console.log("MOT STATUS:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log("MOT ERROR:", errorText);
      return null;
    }

    const motData = await response.json();

    console.log(
      "MOT vehicle found:",
      {
        registration: motData?.registration,
        make: motData?.make,
        model: motData?.model,
      }
    );

    return {
      registration: motData?.registration || null,
      make: motData?.make || null,
      model: motData?.model || null,
      engineSize: motData?.engineSize || motData?.engineCapacity || null,
      fuelType: motData?.fuelType || null,
      color: motData?.primaryColour || motData?.colour || null,
      motStatus: motData?.motStatus || null,
      motExpiry: motData?.motExpiryDate || null,
    };
  } catch(err) {
    console.error("MOT error:", err);
    return null;
  }
}


// ==========================
// GET DVLA VEHICLE DATA
// ==========================

async function getDvlaVehicleData(reg) {
  try {
    const response = await fetchWithTimeout(
      DVLA_URL,
      {
        method: "POST",
        headers: {
          "x-api-key": DVLA_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ registrationNumber: reg }),
      },
      REQUEST_TIMEOUT_MS
    );

    const data = await response.json();

    console.log("DVLA STATUS:", response.status);

    if (!response.ok) {
      console.log("DVLA ERROR:", data?.message || 'Unknown error');
      return null;
    }

    console.log(
      "DVLA vehicle found:",
      {
        registration: reg,
        make: data?.make,
        year: data?.yearOfManufacture,
      }
    );

    return {
      year: data.yearOfManufacture || null,
      make: data.make || null,
      color: data.colour || null,
      fuelType: data.fuelType || null,
      engineSize: data.engineCapacity || null,
      motStatus: data.motStatus || null,
      motExpiry: data.motExpiryDate || null,
    };
  } catch(err) {
    console.error("DVLA request error:", err);
    return null;
  }
}



// ==========================
// VEHICLE LOOKUP
// ==========================

router.post("/lookup", async (req, res) => {

  const { reg } = req.body;

  if (!reg) {

    return res.status(400).json({
      error:
        'Registration number is required'
    });
  }

  // Clean registration
  const cleanReg = reg
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '');

  console.log(
    "Vehicle lookup for:",
    cleanReg
  );

  // Basic validation
  if (
    !/^[A-Z0-9]{2,}$/.test(cleanReg)
    || cleanReg.length < 2
  ) {

    return res.status(400).json({
      error:
        'Please enter a valid registration number'
    });
  }

  try {
    const dvlaData = await getDvlaVehicleData(cleanReg);

    if (!dvlaData) {
      return res.json(
        manualResponse(
          'Vehicle not found in DVLA database. Please enter details manually.'
        )
      );
    }

    const motData = await getMotVehicleData(cleanReg);

    return res.json({
      year: dvlaData.year,
      make: dvlaData.make,
      model: motData?.model || 'Model unavailable',
      color: dvlaData.color || motData?.color || null,
      fuelType: dvlaData.fuelType || motData?.fuelType || null,
      engineSize: dvlaData.engineSize || motData?.engineSize || null,
      motStatus: dvlaData.motStatus || motData?.motStatus || null,
      motExpiry: dvlaData.motExpiry || motData?.motExpiry || null,
      source: motData ? 'dvla+mot' : 'dvla',
    });
  } catch(error) {
    console.error('Vehicle lookup error:', error);
    return res.json(
      manualResponse(
        'Could not verify vehicle. Please enter details manually.'
      )
    );
  }
});



// ==========================
// ENQUIRY SUBMISSION
// ==========================

router.post("/enquiry", async (req, res) => {

  const {
    reg,
    name,
    email,
    phone
  } = req.body;

  if (
    !name ||
    !email
  ) {

    return res.status(400).json({
      success: false,
      message:
        'Name and email are required.'
    });
  }

  try {

    // Save lead
    const Lead =
      require("../models/Lead");

    const lead = new Lead({

      name,
      email,
      phone,

      car: reg,

      date: new Date()
    });

    await lead.save();

    // Send email
    const transporter =
      nodemailer.createTransport({

        service: 'gmail',

        auth: {
          user:
            process.env.GMAIL_USER,

          pass:
            process.env.GMAIL_PASS,
        },
      });

    const mailOptions = {

      from:
        `"Auto Galleria Enquiries" <${process.env.GMAIL_USER}>`,

      to:
        process.env.GMAIL_TO,

      replyTo:
        `"${name}" <${email}>`,

      subject:
        `New Vehicle Enquiry - ${reg}`,

      html: `
        <h2>New Vehicle Enquiry</h2>

        <p>
          <strong>Registration:</strong>
          ${reg}
        </p>

        <p>
          <strong>Name:</strong>
          ${name}
        </p>

        <p>
          <strong>Email:</strong>
          ${email}
        </p>

        ${
          phone
            ? `
              <p>
                <strong>Phone:</strong>
                ${phone}
              </p>
            `
            : ''
        }
      `,
    };

    await transporter.sendMail(
      mailOptions
    );

    return res.json({
      success: true,
      message:
        'Enquiry submitted successfully!'
    });

  } catch(err) {

    console.error(
      'Email send error or DB error:',
      err
    );

    return res.json({
      success: false,
      message:
        'Failed to submit enquiry'
    });
  }
});



// ==========================
// TEST ROUTE
// ==========================

router.get("/test", (req, res) => {

  res.json({
    msg:
      "Vehicle route works ✅"
  });
});



module.exports = router;