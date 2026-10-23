// Разбор сессионного YAML iRacing. Имена пилотов и команд в нём не экранированы
// (двоеточия, кавычки, ведущие нули в номерах), поэтому такие значения сначала берём в кавычки.
const yaml = require('js-yaml');

const STRING_KEYS = [
  'UserName', 'TeamName', 'AbbrevName', 'Initials', 'DriverName', 'CarNumber',
  'CarScreenName', 'CarScreenNameShort', 'CarClassShortName', 'CarDesignStr',
  'HelmetDesignStr', 'SuitDesignStr', 'CarSponsor_1', 'CarSponsor_2', 'ClubName',
  'DivisionName', 'TrackDisplayName', 'TrackDisplayShortName', 'TrackConfigName',
  'TrackCity', 'TrackCountry', 'SeriesName', 'LicString',
];
const KEY_RE = new RegExp(`^(\\s*(?:- )?)(${STRING_KEYS.join('|')}): (.*)$`, 'gm');

function sanitize(raw) {
  return raw.replace(KEY_RE, (_, indent, key, value) => {
    let v = value.trim();
    // iRacing сам берёт номера машин в двойные кавычки (CarNumber: "12") — это кавычки YAML, а не часть номера
    const quoted = v.match(/^"(.*)"$/);
    if (quoted) v = quoted[1];
    v = v.replace(/'/g, "''");
    return `${indent}${key}: '${v}'`;
  });
}

function parseSessionInfo(raw) {
  if (!raw) return null;
  try {
    return yaml.load(sanitize(raw), { json: true });
  } catch (e) {
    console.warn('[sessionInfo] YAML parse failed:', e.message);
    return null;
  }
}

module.exports = { parseSessionInfo, sanitize };
