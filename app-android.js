
'use strict';

const DNP_VENDOR_ID = 0x1343;
const RX1_PRODUCT_ID = 0x0005;

let connected = false;
let refreshTimer = null;
let busy = false;
let diagLines = [];

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
  0:['Prête','ok'],1:['Impression en cours','info'],500:['Refroidissement tête','warn'],
  510:['Refroidissement moteur papier','warn'],1000:['Capot ouvert','error'],
  1010:['Bac à chutes absent','error'],1100:['Papier épuisé','error'],1200:['Ruban épuisé','error'],
  1300:['Bourrage papier','error'],1400:['Erreur ruban','error'],1500:['Erreur définition papier','error'],
  1600:['Erreur de données','error'],2000:['Erreur tension tête','error'],2100:['Erreur position tête','error'],
  2200:['Erreur ventilateur alimentation','error'],2300:['Erreur massicot','error'],
  2400:['Erreur rouleau presseur','error'],2500:['Température tête anormale','error'],
  2600:['Température média anormale','error'],2610:['Température moteur papier anormale','error'],
  2700:['Erreur tension ruban','error'],2800:['Erreur module RF-ID','error'],3000:['Erreur système','error']
};
const MEDIA_MAP = {
  200:{label:'5 × 3,5″ (L)',nominal:null},210:{label:'5 × 7″ (2L)',nominal:400},
  300:{label:'6 × 4″ / 10 × 15 cm',nominal:700},310:{label:'6 × 8″ / 15 × 20 cm',nominal:350},
  400:{label:'6 × 9″ (A5W)',nominal:null},500:{label:'8 × 10″',nominal:null},510:{label:'8 × 12″',nominal:null}
};

function log(message,data){
  const time=new Date().toLocaleTimeString('fr-FR');
  let line=`[${time}] ${message}`;
  if(data!==undefined){try{line+=` ${typeof data==='string'?data:JSON.stringify(data)}`;}catch{}}
  diagLines.push(line); if(diagLines.length>250) diagLines=diagLines.slice(-250);
  ui.diagnostic.textContent=diagLines.join('\n');
}
function setMessage(text,cls=''){ui.message.textContent=text;ui.message.className=`message ${cls}`.trim();}
function setConnectedUi(v){
  connected=v; ui.usbBadge.textContent=v?'USB connecté':'USB déconnecté';
  ui.usbBadge.className=`badge ${v?'badge-on':'badge-off'}`;
  ui.connectBtn.disabled=v; ui.refreshBtn.disabled=!v; ui.disconnectBtn.disabled=!v;
}
function parseStatus(raw){
  if(!raw)return{code:null,label:'Non lu',cls:'warn'};
  const m=raw.match(/\d{5}/)||raw.match(/\d+/); const code=m?parseInt(m[0],10):null; const x=STATUS_MAP[code];
  return x?{code,label:x[0],cls:x[1]}:{code,label:raw||'État inconnu',cls:'warn'};
}
function parseMedia(raw){
  if(!raw)return{code:null,label:'Non lu',nominal:null};
  let code=parseInt(raw.slice(4,7),10);
  if(!Number.isFinite(code)){const m=raw.match(/(?:^|\D)(200|210|300|310|400|500|510)(?:\D|$)/);code=m?parseInt(m[1],10):null;}
  const x=MEDIA_MAP[code]; return x?{code,...x}:{code,label:`Média ${raw}`,nominal:null};
}
function parsePrefixedNumber(raw,prefixLength=0){
  if(!raw)return null; const s=raw.slice(prefixLength); const m=s.match(/\d+/)||raw.match(/\d+/); return m?parseInt(m[0],10):null;
}
function updateDisplay(data){
  const status=parseStatus(data.status); ui.statusText.textContent=status.label; ui.statusText.className=`value status-value ${status.cls}`;
  ui.statusCode.textContent=`Code : ${status.code??'—'}${data.status?` • brut ${data.status}`:''}`;
  const media=parseMedia(data.media); ui.mediaText.textContent=media.label; ui.mediaCode.textContent=`Code média : ${media.code??'—'}${data.media?` • brut ${data.media}`:''}`;
  const remaining=parsePrefixedNumber(data.remaining,4); ui.remainingText.textContent=Number.isFinite(remaining)?remaining.toLocaleString('fr-FR'):'—';
  ui.mediaStateText.textContent=Number.isFinite(remaining)?`${remaining.toLocaleString('fr-FR')} tirages`:'—';
  ui.mediaStateSub.textContent=Number.isFinite(remaining)?'Média restant renvoyé par la DNP (papier + ruban assortis)':'La RX1HS utilise un kit papier + ruban';
  if(Number.isFinite(remaining)&&media.nominal){const pct=Math.max(0,Math.min(100,remaining/media.nominal*100));ui.remainingBar.style.width=`${pct}%`;ui.remainingSub.textContent=`≈ ${Math.round(pct)} % du rouleau nominal (${media.nominal} tirages au format média)`;}
  else{ui.remainingBar.style.width='0%';ui.remainingSub.textContent=Number.isFinite(remaining)?'Valeur fournie par l’imprimante':'Non disponible';}
  const life=parsePrefixedNumber(data.life,2); ui.lifeText.textContent=Number.isFinite(life)?life.toLocaleString('fr-FR'):'—';
  ui.serialText.textContent=data.serial||'—'; ui.firmwareText.textContent=data.firmware||'—'; ui.bufferText.textContent=data.buffer||'—';
  ui.lastUpdate.textContent=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function query(group,command){
  const r=AndroidUsb.query(group,command);
  if(r && r.startsWith('__ERROR__:')) throw new Error(r.substring(10));
  log(`← ${group}/${command}:`,r||'(vide)'); return r;
}
function safeQuery(group,command){try{return query(group,command);}catch(e){log(`⚠ ${group}/${command} non lu:`,e.message);return null;}}
function refreshAll(){
  if(!connected||busy)return; busy=true; ui.refreshBtn.disabled=true; setMessage('Lecture de la DNP…','info');
  try{
    const data={status:safeQuery('STATUS',''),remaining:safeQuery('INFO','MQTY'),media:safeQuery('INFO','MEDIA'),
      buffer:safeQuery('INFO','FREE_PBUFFER'),firmware:safeQuery('INFO','FVER'),serial:safeQuery('INFO','SERIAL_NUMBER'),
      life:safeQuery('MNT_RD','COUNTER_LIFE')};
    updateDisplay(data);
    setMessage(data.status||data.remaining||data.media?'Lecture terminée.':'DNP connectée mais aucune réponse. Ouvre le diagnostic.',data.status||data.remaining||data.media?'ok':'warn');
  }catch(e){log('Erreur de rafraîchissement:',e.message);setMessage(`Erreur : ${e.message}`,'error');}
  finally{busy=false;ui.refreshBtn.disabled=!connected;}
}
function connectPrinter(){
  setMessage('Connexion à la DNP RX1HS…','info');
  const r=AndroidUsb.connect();
  if(r==='OK'){setConnectedUi(true);setMessage('DNP connectée. Lecture des informations…','ok');refreshAll();clearInterval(refreshTimer);refreshTimer=setInterval(refreshAll,10000);}
  else if(r==='PERMISSION_REQUESTED'){setMessage('Autorise l’accès USB à la DNP, puis appuie de nouveau sur Connecter.','info');}
  else{setMessage(`Connexion impossible : ${r}`,'error');log('Échec de connexion:',r);}
}
function disconnectPrinter(show=true){clearInterval(refreshTimer);refreshTimer=null;try{AndroidUsb.disconnect();}catch{}setConnectedUi(false);if(show)setMessage('DNP déconnectée.');}
ui.connectBtn.addEventListener('click',connectPrinter); ui.refreshBtn.addEventListener('click',refreshAll); ui.disconnectBtn.addEventListener('click',()=>disconnectPrinter(true));
ui.copyDiagBtn.addEventListener('click',()=>{try{AndroidUsb.copyText(ui.diagnostic.textContent);setMessage('Diagnostic copié.','ok');}catch{setMessage('Copie impossible.','warn');}});
ui.clearDiagBtn.addEventListener('click',()=>{diagLines=[];ui.diagnostic.textContent='Diagnostic effacé.';});
ui.compatWarning.classList.add('hidden'); setConnectedUi(false); setMessage('Application Android prête. Branche la DNP puis appuie sur Connecter.');
