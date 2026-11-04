#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const RES_DIR = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res');
const VALUES_DIR = path.join(RES_DIR, 'values');
const CONFIG_FILE = path.join(ROOT, 'capacitor.config.ts');
const STRINGS_FILE = path.join(VALUES_DIR, 'strings.xml');
const COLORS_FILE = path.join(VALUES_DIR, 'colors.xml');
const ICON_BACKGROUND_FILE = path.join(VALUES_DIR, 'ic_launcher_background.xml');

const DENSITIES = [
  { dir: 'mipmap-mdpi', legacy: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', legacy: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', legacy: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', legacy: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', legacy: 192, foreground: 432 },
];

function fail(message) {
  throw new Error(message);
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} wajib diisi.`);
  }
  return value.trim();
}

function validateUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('INPUT_URL bukan URL yang valid.');
  }

  if (parsed.protocol !== 'https:') {
    fail('INPUT_URL harus memakai protokol https://.');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    fail('INPUT_URL tidak boleh memuat kredensial dan harus memiliki hostname.');
  }

  return parsed.toString();
}

function validateAppName(value) {
  const name = value.trim();
  if (name.length < 2 || name.length > 30) {
    fail('INPUT_APPNAME harus 2 sampai 30 karakter.');
  }
  if (/[\u0000-\u001F\u007F]/.test(name)) {
    fail('INPUT_APPNAME tidak boleh memuat karakter kontrol atau baris baru.');
  }
  return name;
}

function validateThemeColor(value) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
    fail('INPUT_THEMECOLOR harus memakai format #RRGGBB.');
  }
  return value.toUpperCase();
}

function decodeLogo(value) {
  let cleaned = value
    .replace(/^data:image\/(?:png|jpe?g);base64,/i, '')
    .replace(/\s+/g, '');

  if (cleaned.length % 4 !== 0) {
    cleaned += '='.repeat(4 - (cleaned.length % 4));
  }

  if (!cleaned || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    fail('INPUT_LOGO_BASE64 bukan data base64 yang valid.');
  }

  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) {
    fail('INPUT_LOGO_BASE64 kosong.');
  }
  if (buffer.length > 2 * 1024 * 1024) {
    fail('Logo melebihi batas 2 MB.');
  }

  return buffer;
}

function escapeXml(value) {
  return value.replace(/[<>&'"]/g, (character) => {
    switch (character) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return character;
    }
  });
}

function replaceConfigValue(source, key, value) {
  const pattern = new RegExp(`^(\\s*${key}:\\s*).*$`, 'm');
  if (!pattern.test(source)) {
    fail(`Nilai ${key} tidak ditemukan di capacitor.config.ts.`);
  }
  return source.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)},`);
} // <--- INI KURUNG PENUTUP YANG TADI HILANG

function setStringResource(xml, name, value) {
  const pattern = new RegExp(`(<string name="${name}">)[\\s\\S]*?(</string>)`);

  if (pattern.test(xml)) {
    return xml.replace(pattern, (_match, prefix, suffix) => {
      return `${prefix}${escapeXml(value)}${suffix}`;
    });
  }

  return xml.replace('</resources>', `    <string name="${name}">${escapeXml(value)}</string>\n</resources>`);
}

function setColorResource(xml, name, value) {
  const pattern = new RegExp(`(<color name="${name}">)[\\s\\S]*?(</color>)`);

  if (pattern.test(xml)) {
    return xml.replace(pattern, (_match, prefix, suffix) => {
      return `${prefix}${value}${suffix}`;
    });
  }

  return xml.replace('</resources>', `    <color name="${name}">${value}</color>\n</resources>`);
}

function darkenColor(hex, factor) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = Math.round(((value >> 16) & 0xff) * factor);
  const green = Math.round(((value >> 8) & 0xff) * factor);
  const blue = Math.round((value & 0xff) * factor);
  const channel = (part) => part.toString(16).padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

async function readLogoMetadata(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    fail('Logo tidak dapat dibaca. Pastikan file PNG atau JPG valid.');
  }

  if (!metadata.format || !['png', 'jpeg', 'jpg'].includes(metadata.format)) {
    fail('Logo harus berupa gambar PNG atau JPG.');
  }
}

async function writeIcons(buffer) {
  const source = sharp(buffer).rotate();

  for (const density of DENSITIES) {
    const directory = path.join(RES_DIR, density.dir);
    fs.mkdirSync(directory, { recursive: true });

    await source
      .clone()
      .resize(density.legacy, density.legacy, { fit: 'cover' })
      .png()
      .toFile(path.join(directory, 'ic_launcher.png'));

    const roundBuffer = await source
      .clone()
      .resize(density.legacy, density.legacy, { fit: 'cover' })
      .png()
      .toBuffer();

    const circleMask = Buffer.from(
      `<svg width="${density.legacy}" height="${density.legacy}" xmlns="http://www.w3.org/2000/svg"><circle cx="${density.legacy / 2}" cy="${density.legacy / 2}" r="${density.legacy / 2}" fill="#FFFFFF"/></svg>`,
    );

    await sharp(roundBuffer)
      .composite([{ input: circleMask, blend: 'dest-in' }])
      .png()
      .toFile(path.join(directory, 'ic_launcher_round.png'));

    const innerSize = Math.round(density.foreground * 0.62);
    const innerBuffer = await source
      .clone()
      .resize(innerSize, innerSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: density.foreground,
        height: density.foreground,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: innerBuffer, gravity: 'center' }])
      .png()
      .toFile(path.join(directory, 'ic_launcher_foreground.png'));
  }
}

async function main() {
  if (!fs.existsSync(ANDROID_DIR)) {
    fail('Folder android/ tidak ditemukan. Jalankan "npx cap add android" terlebih dahulu.');
  }
  if (!fs.existsSync(STRINGS_FILE)) {
    fail('android/app/src/main/res/values/strings.xml tidak ditemukan.');
  }

  const url = validateUrl(readRequiredEnv('INPUT_URL'));
  const appName = validateAppName(readRequiredEnv('INPUT_APPNAME'));
  const themeColor = validateThemeColor(readRequiredEnv('INPUT_THEMECOLOR'));
  const logoBuffer = decodeLogo(readRequiredEnv('INPUT_LOGO_BASE64'));

  await readLogoMetadata(logoBuffer);

  const config = fs.readFileSync(CONFIG_FILE, 'utf8');
  const nextConfig = replaceConfigValue(
    replaceConfigValue(config, 'appName', appName),
    'url',
    url,
  );
  fs.writeFileSync(CONFIG_FILE, nextConfig, 'utf8');

  const strings = fs.readFileSync(STRINGS_FILE, 'utf8');
  const nextStrings = setStringResource(
    setStringResource(strings, 'app_name', appName),
    'title_activity_main',
    appName,
  );
  fs.writeFileSync(STRINGS_FILE, nextStrings, 'utf8');

  let colors = fs.existsSync(COLORS_FILE)
    ? fs.readFileSync(COLORS_FILE, 'utf8')
    : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';

  colors = setColorResource(colors, 'colorPrimary', themeColor);
  colors = setColorResource(colors, 'colorPrimaryDark', darkenColor(themeColor, 0.82));
  colors = setColorResource(colors, 'colorAccent', themeColor);
  fs.writeFileSync(COLORS_FILE, colors, 'utf8');

  let iconBackground = fs.existsSync(ICON_BACKGROUND_FILE)
    ? fs.readFileSync(ICON_BACKGROUND_FILE, 'utf8')
    : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
  iconBackground = setColorResource(iconBackground, 'ic_launcher_background', themeColor);
  fs.writeFileSync(ICON_BACKGROUND_FILE, iconBackground, 'utf8');

  await writeIcons(logoBuffer);

  console.log(`[inject-config] ${appName} -> ${url}`);
  console.log(`[inject-config] ${DENSITIES.length} varian ikon dan warna ${themeColor} diterapkan.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Konfigurasi gagal diterapkan.';
  console.error(`[inject-config] ${message}`);
  process.exit(1);
});
