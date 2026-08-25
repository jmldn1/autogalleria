const DEFAULT_SITE_URL = 'https://autogalleria.co.uk';

function getSiteUrl() {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

function buildCanonicalUrl(path = '') {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${getSiteUrl()}${suffix}`;
}

function toAbsoluteUrl(value) {
  if (!value || typeof value !== 'string') return null;

  try {
    return new URL(value, `${getSiteUrl()}/`).toString();
  } catch (err) {
    return null;
  }
}

module.exports = { getSiteUrl, buildCanonicalUrl, toAbsoluteUrl };
