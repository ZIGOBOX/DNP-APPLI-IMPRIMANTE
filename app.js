'use strict';

// DNP DS-RX1 / DS-RX1HS USB IDs documented by the Gutenprint dye-sub backend.
const DNP_VENDOR_ID = 0x1343;
const RX1_PRODUCT_ID = 0x0005;

let device = null;
let interfaceNumber = null;
let inEndpoint = null;
let outEndpoint = null;
let refreshTimer = null;
let busy = false;
let diagLines = [];
let lastResponses = {};

const $ = (id) => document.getElementById(id);
const ui = {
  usbBadge: $('usbBadge'), connectBtn: $('connectBtn'), refreshBtn: $('refreshBtn'),
  disconnectBtn: $('disconnectBtn'), message: $('message'), compatWarning: $('compatWarning'),
  statusText: $('statusText'), statusCode: $('statusCode'), remainingText: $('remainingText'),
  remainingSub: $('remainingSub'), remainingBar: $('remainingBar'), mediaStateText: $('mediaStateText'),
  mediaStateSub: $('mediaStateSub'), mediaText: $('mediaText'), mediaCode: $('mediaCode'),
  lifeText: $('lifeText'), lastUpdate: $('lastUpdate'), serialText: $('serialText'),
  firmwareText: $('firmwareText'), bufferText: $('bufferText'), diagnostic: $('diagnostic'),
  copyDiagBtn: $('copyDiagBtn'), clearDiagBtn: $('clearDiagBtn')
};

const STATUS_MAP = {
  0: ['Prête', 'ok'],
  1: ['Impression en cours', 'info'],
  500: ['Refroidissement tête', 'warn'],
  510: ['Refroidissement moteur papier', 'warn'],
  1000: ['Capot ouvert', 'error'],
  1010: ['Bac à chutes absent', 'error'],
  1100: ['Papier épuisé', 'error'],
  1200: ['Ruban épuisé', 'error'],
  1300: ['Bourrage papier', 'error'],
  1400: ['Erreur ruban', 'error'],
  1500: ['Erreur définition papier', 'error'],
  1600: ['Erreur de données', 'error'],
  2000: ['Erreur tension tête', 'error'],
  2100: ['Erreur position tête', 'error'],
  2200: ['Erreur ventilateur alimentation', 'error'],
  2300: ['Erreur massicot', 'error'],
  2400: ['Erreur rouleau presseur', 'error'],
  2500: ['Température tête anormale', 'error'],
  2600: ['Température média anormale', 'error'],
  2610: ['Température moteur papier anormale', 'error'],
  2700: ['Erreur tension ruban', 'error'],
  2800: ['Erreur module RF-ID', 'error'],
  3000: ['Erreur système', 'error']
};

const MEDIA_MAP = {
  200: { label: '5 × 3,5″ (L)', nominal: null },
  210: { label: '5 × 7″ (2L)', nominal: 400 },
  300: { label: '6 × 4″ / 10 × 15 cm', nominal: 700 },
  310: { label: '6 × 8″ / 15 × 20 cm', nominal: 350 },
  400: { label: '6 × 9″ (A5W)', nominal: null },
  500: { label: '8 × 10″', nominal: null },
  510: { label: '8 × 12″', nominal: null }
};

function log(message, data) {
  const time = new Date().toLocaleTimeString('fr-FR');
  let line = `[${time}] ${message}`;
  if (data !== undefined) {
    try { line += ` ${typeof data === 'string' ? data : JSON.stringify(data)}`; }
    catch { line += ' [données non sérialisables]'; }
  }
  diagLines.push(line);
  if (diagLines.length > 250) diagLines = diagLines.slice(-250);
  ui.diagnostic.textContent = diagLines.join('\n');
}

function setMessage(text, cls = '') {
  ui.message.textContent = text;
  ui.message.className = `message ${cls}`.trim();
}

function setConnectedUi(connected) {
  ui.usbBadge.textContent = connected ? 'USB connecté' : 'USB déconnecté';
  ui.usbBadge.className = `badge ${connected ? 'badge-on' : 'badge-off'}`;
  ui.connectBtn.disabled = connected;
  ui.refreshBtn.disabled = !connected;
  ui.disconnectBtn.disabled = !connected;
}

function cleanAscii(bytes) {
  const text = new TextDecoder('ascii').decode(bytes);
  return text.split('\r')[0].replace(/\0/g, '').trimEnd();
}

function buildCommand(group, command, payloadLength = 0) {
  const bytes = new Uint8Array(32);
  bytes.fill(0x20);
  bytes[0] = 0x1b;
  bytes[1] = 0x50;
  const enc = new TextEncoder();
  bytes.set(enc.encode(group).slice(0, 6), 2);
  bytes.set(enc.encode(command).slice(0, 16), 8);
  if (payloadLength > 0) {
    bytes.set(enc.encode(String(payloadLength).padStart(8, '0')).slice(0, 8), 24);
  }
  return bytes;
}

async function readExact(length) {
  const chunks = [];
  let received = 0;
  let attempts = 0;
  while (received < length && attempts < 12) {
    attempts++;
    const result = await device.transferIn(inEndpoint, length - received);
    if (result.status !== 'ok') throw new Error(`Lecture USB: ${result.status}`);
    const part = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    if (!part.length) break;
    chunks.push(new Uint8Array(part));
    received += part.length;
  }
  if (received < length) throw new Error(`Réponse USB incomplète (${received}/${length} octets)`);
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out.slice(0, length);
}

async function query(group, command) {
  const packet = buildCommand(group, command, 0);
  const sent = await device.transferOut(outEndpoint, packet);
  if (sent.status !== 'ok') throw new Error(`Envoi USB ${group}/${command}: ${sent.status}`);

  const headerBytes = await readExact(8);
  const header = cleanAscii(headerBytes).trim();
  const length = Number.parseInt(header, 10);
  if (!Number.isFinite(length) || length < 0 || length > 65536) {
    throw new Error(`Longueur de réponse invalide pour ${group}/${command}: « ${header} »`);
  }
  const payload = length ? await readExact(length) : new Uint8Array();
  const text = cleanAscii(payload);
  lastResponses[`${group}/${command}`] = text;
  log(`← ${group}/${command}:`, text || '(vide)');
  await new Promise(r => setTimeout(r, 25));
  return text;
}

async function safeQuery(group, command) {
  try { return await query(group, command); }
  catch (error) {
    log(`⚠ ${group}/${command} non lu:`, error.message);
    return null;
  }
}

function findBulkInterface(dev) {
  if (!dev.configuration) return null;
  for (const iface of dev.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const epIn = alt.endpoints.find(e => e.direction === 'in' && e.type === 'bulk');
      const epOut = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
      if (epIn && epOut) {
        return {
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alt.alternateSetting,
          inEndpoint: epIn.endpointNumber,
          outEndpoint: epOut.endpointNumber
        };
      }
    }
  }
  return null;
}

function parseStatus(raw) {
  if (!raw) return { code: null, label: 'Non lu', cls: 'warn' };
  const m = raw.match(/\d{5}/) || raw.match(/\d+/);
  const code = m ? Number.parseInt(m[0], 10) : null;
  const mapped = code !== null ? STATUS_MAP[code] : null;
  return mapped ? { code, label: mapped[0], cls: mapped[1] } : { code, label: raw || 'État inconnu', cls: 'warn' };
}

function parseMedia(raw) {
  if (!raw) return { code: null, label: 'Non lu', nominal: null };
  let code = Number.parseInt(raw.slice(4, 7), 10);
  if (!Number.isFinite(code)) {
    const match = raw.match(/(?:^|\D)(200|210|300|310|400|500|510)(?:\D|$)/);
    code = match ? Number.parseInt(match[1], 10) : null;
  }
  const info = code !== null ? MEDIA_MAP[code] : null;
  return info ? { code, ...info } : { code, label: `Média ${raw}`, nominal: null };
}

function parsePrefixedNumber(raw, prefixLength = 0) {
  if (!raw) return null;
  const sliced = raw.slice(prefixLength);
  const m = sliced.match(/\d+/) || raw.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : null;
}

function updateDisplay(data) {
  const status = parseStatus(data.status);
  ui.statusText.textContent = status.label;
  ui.statusText.className = `value status-value ${status.cls}`;
  ui.statusCode.textContent = `Code : ${status.code ?? '—'}${data.status ? ` • brut ${data.status}` : ''}`;

  const media = parseMedia(data.media);
  ui.mediaText.textContent = media.label;
  ui.mediaCode.textContent = `Code média : ${media.code ?? '—'}${data.media ? ` • brut ${data.media}` : ''}`;

  const remaining = parsePrefixedNumber(data.remaining, 4);
  ui.remainingText.textContent = Number.isFinite(remaining) ? remaining.toLocaleString('fr-FR') : '—';
  ui.mediaStateText.textContent = Number.isFinite(remaining) ? `${remaining.toLocaleString('fr-FR')} tirages` : '—';
  ui.mediaStateSub.textContent = Number.isFinite(remaining)
    ? 'Média restant renvoyé par la DNP (papier + ruban assortis)'
    : 'La RX1HS utilise un kit papier + ruban';

  if (Number.isFinite(remaining) && media.nominal) {
    const pct = Math.max(0, Math.min(100, remaining / media.nominal * 100));
    ui.remainingBar.style.width = `${pct}%`;
    ui.remainingSub.textContent = `≈ ${Math.round(pct)} % du rouleau nominal (${media.nominal} tirages au format média)`;
  } else {
    ui.remainingBar.style.width = '0%';
    ui.remainingSub.textContent = Number.isFinite(remaining) ? 'Valeur fournie par l’imprimante' : 'Non disponible';
  }

  const life = parsePrefixedNumber(data.life, 2);
  ui.lifeText.textContent = Number.isFinite(life) ? life.toLocaleString('fr-FR') : '—';
  ui.serialText.textContent = data.serial || '—';
  ui.firmwareText.textContent = data.firmware || '—';
  ui.bufferText.textContent = data.buffer || '—';
  ui.lastUpdate.textContent = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

async function refreshAll() {
  if (!device?.opened || busy) return;
  busy = true;
  ui.refreshBtn.disabled = true;
  setMessage('Lecture de la DNP…', 'info');
  try {
    const data = {};
    // Read-only queries only. No print, reset, clear-counter or write command is sent.
    data.status = await safeQuery('STATUS', '');
    data.remaining = await safeQuery('INFO', 'MQTY');
    data.media = await safeQuery('INFO', 'MEDIA');
    data.buffer = await safeQuery('INFO', 'FREE_PBUFFER');
    data.firmware = await safeQuery('INFO', 'FVER');
    data.serial = await safeQuery('INFO', 'SERIAL_NUMBER');
    data.life = await safeQuery('MNT_RD', 'COUNTER_LIFE');
    updateDisplay(data);

    if (data.status || data.remaining || data.media) {
      setMessage('Lecture terminée.', 'ok');
    } else {
      setMessage('L’imprimante est connectée mais n’a pas répondu aux requêtes. Ouvre le diagnostic.', 'warn');
    }
  } catch (error) {
    log('Erreur de rafraîchissement:', error.message);
    setMessage(`Erreur : ${error.message}`, 'error');
  } finally {
    busy = false;
    ui.refreshBtn.disabled = !device?.opened;
  }
}

async function connectPrinter() {
  if (!('usb' in navigator)) {
    showCompatibilityProblem();
    return;
  }
  try {
    setMessage('Choisis la DNP RX1HS dans la fenêtre Android…', 'info');
    device = await navigator.usb.requestDevice({
      filters: [{ vendorId: DNP_VENDOR_ID, productId: RX1_PRODUCT_ID }]
    });
    log('Périphérique choisi:', {
      vendorId: `0x${device.vendorId.toString(16).padStart(4, '0')}`,
      productId: `0x${device.productId.toString(16).padStart(4, '0')}`,
      productName: device.productName || null,
      manufacturerName: device.manufacturerName || null,
      serialNumber: device.serialNumber || null
    });

    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    const found = findBulkInterface(device);
    if (!found) throw new Error('Aucune interface USB Bulk IN/OUT trouvée sur la DNP.');

    interfaceNumber = found.interfaceNumber;
    inEndpoint = found.inEndpoint;
    outEndpoint = found.outEndpoint;
    await device.claimInterface(interfaceNumber);

    const iface = device.configuration.interfaces.find(i => i.interfaceNumber === interfaceNumber);
    const currentAlt = iface?.alternate?.alternateSetting;
    if (Number.isFinite(found.alternateSetting) && currentAlt !== found.alternateSetting) {
      await device.selectAlternateInterface(interfaceNumber, found.alternateSetting);
    }

    log('Interface USB prête:', found);
    setConnectedUi(true);
    setMessage('DNP connectée. Lecture des informations…', 'ok');
    await refreshAll();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshAll, 10000);
  } catch (error) {
    log('Échec de connexion:', error.message);
    setMessage(error.name === 'NotFoundError' ? 'Connexion annulée ou DNP non sélectionnée.' : `Connexion impossible : ${error.message}`, 'error');
    await disconnectPrinter(false);
  }
}

async function disconnectPrinter(showMessage = true) {
  clearInterval(refreshTimer);
  refreshTimer = null;
  if (device) {
    try {
      if (device.opened && interfaceNumber !== null) await device.releaseInterface(interfaceNumber);
    } catch (e) { log('Release interface:', e.message); }
    try { if (device.opened) await device.close(); }
    catch (e) { log('Fermeture USB:', e.message); }
  }
  device = null;
  interfaceNumber = null;
  inEndpoint = null;
  outEndpoint = null;
  busy = false;
  setConnectedUi(false);
  if (showMessage) setMessage('DNP déconnectée.');
}

function showCompatibilityProblem() {
  let text = '';
  if (!window.isSecureContext) {
    text = 'WebUSB exige une page HTTPS. Ouvre cette page depuis ton adresse GitHub Pages (https://…), pas directement depuis un fichier téléchargé.';
  } else if (!('usb' in navigator)) {
    text = 'WebUSB n’est pas disponible dans ce navigateur. Utilise Google Chrome sur Android, à jour.';
  }
  if (text) {
    ui.compatWarning.textContent = text;
    ui.compatWarning.classList.remove('hidden');
    ui.connectBtn.disabled = true;
    setMessage(text, 'warn');
  }
}

ui.connectBtn.addEventListener('click', connectPrinter);
ui.refreshBtn.addEventListener('click', refreshAll);
ui.disconnectBtn.addEventListener('click', () => disconnectPrinter(true));
ui.copyDiagBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ui.diagnostic.textContent);
    setMessage('Diagnostic copié.', 'ok');
  } catch {
    setMessage('Impossible de copier automatiquement. Fais un appui long sur le diagnostic.', 'warn');
  }
});
ui.clearDiagBtn.addEventListener('click', () => {
  diagLines = [];
  lastResponses = {};
  ui.diagnostic.textContent = 'Diagnostic effacé.';
});

if ('usb' in navigator) {
  navigator.usb.addEventListener('disconnect', (event) => {
    if (device && event.device === device) {
      log('DNP débranchée physiquement.');
      disconnectPrinter(false);
      setMessage('Le câble USB a été débranché.', 'warn');
    }
  });
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

showCompatibilityProblem();
setConnectedUi(false);
