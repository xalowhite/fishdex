/* ============================================================
   FishDex app logic v2
   ============================================================ */

// Runtime polygon sources (browser fetch; falls back in order).
const GEO_SOURCES = [
  { key:"us", urls:[
      "https://cdn.jsdelivr.net/gh/PublicaMundi/MappingAPI@master/data/geojson/us-states.json",
      "https://raw.githubusercontent.com/python-visualization/folium/main/examples/data/us-states.json",
      "https://cdn.jsdelivr.net/gh/codeforgermany/click_that_hood@main/public/data/united-states.geojson"
  ]},
  { key:"ca", urls:[
      "https://cdn.jsdelivr.net/gh/codeforgermany/click_that_hood@main/public/data/canada.geojson",
      "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/canada.geojson"
  ]},
  { key:"mx", urls:[
      "https://cdn.jsdelivr.net/gh/codeforgermany/click_that_hood@main/public/data/mexico.geojson",
      "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/mexico.geojson"
  ]}
];

const state = {
  angling:false, month:"", tod:new Set(), water:new Set(),
  selectedFish:null, selectedSub:null, selectedState:null, selectedEco:null, query:""
};

let map, stateLayers={}, normIndex={};  // normIndex: normalized name -> display name

// Contiguous-US states: when a fish has ecoregion data, these are shown via
// ecoregion polygons instead of whole-state fills (AK/HI/Canada/Mexico stay state-level).
const LOWER48 = new Set(["Alabama","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
  "Florida","Georgia","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine",
  "Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma",
  "Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah",
  "Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"].map(s=>s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase()));

/* ---------- name normalization (accent/case-insensitive) ---------- */
function norm(s){ return (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase()
  .replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim(); }

function fishById(id){ return FISH.find(f=>f.id===id); }
function fishStates(f, subIdx){
  if(subIdx!=null && f.subs && f.subs[subIdx]) return f.subs[subIdx].states;
  return f.states;
}
function fishStatesNorm(f, subIdx){ return new Set(fishStates(f,subIdx).map(norm)); }

/* ---------- ecoregion range helpers (US freshwater sharpening) ---------- */
// usesEco requires ecoData to be loaded; until then a fish falls back to whole-state display.
function usesEco(f, subIdx){ return subIdx==null && !!ecoData && typeof ECO_RANGE!=="undefined" && !!ECO_RANGE[f.id]; }
function fishEco(f, subIdx){ return usesEco(f,subIdx) ? ECO_RANGE[f.id] : []; }
function fishEcoNorm(f, subIdx){ return new Set(fishEco(f,subIdx).map(norm)); }
// states to highlight for a fish: if it has eco, drop lower-48 (shown as ecoregions) but keep AK/HI/Canada/Mexico
function fishHighlightStates(f, subIdx){
  const sts=fishStates(f,subIdx);
  return usesEco(f,subIdx) ? sts.filter(s=>!LOWER48.has(norm(s))) : sts;
}

/* ---------- bite score (blend month + time of day) ---------- */
function monthScore(f){
  if(state.month==="") return null;
  const m=+state.month;
  let best=99;
  for(const bm of f.bestMonths){ let d=Math.abs(bm-m); d=Math.min(d,12-d); best=Math.min(best,d); }
  if(best===0) return 1; if(best===1) return 0.6; if(best===2) return 0.3; return 0.1;
}
function todScore(f){
  if(state.tod.size===0) return null;
  return f.tod.some(t=>state.tod.has(t)) ? 1 : 0.2;
}
function evalFish(f){
  if(state.water.size && !f.water.some(w=>state.water.has(w))) return {visible:false};
  if(!state.angling) return {visible:true, rating:null, pct:null};
  const parts=[monthScore(f),todScore(f)].filter(x=>x!==null);
  if(parts.length===0) return {visible:true, rating:"good", pct:65};
  const avg=parts.reduce((a,b)=>a+b,0)/parts.length;
  const pct=Math.round(avg*100);
  const rating = avg>=0.75?"peak":avg>=0.42?"good":"slow";
  return {visible:true, rating, pct};
}

/* ---------- fish silhouettes (inline SVG) ---------- */
function fishSVG(shape, color, w){
  w=w||44; const h=Math.round(w*0.6);
  const c=color||"#5bbf9b", dk="rgba(0,0,0,.35)";
  let body;
  switch(shape){
    case "pike": case "gar":
      body=`<path d="M2 30 C20 16,55 16,78 27 L96 19 L90 30 L96 41 L78 33 C55 44,20 44,2 30 Z" fill="${c}"/>
            <circle cx="20" cy="28" r="2.4" fill="${dk}"/>`; break;
    case "flounder":
      body=`<ellipse cx="46" cy="30" rx="42" ry="20" fill="${c}"/>
            <path d="M88 30 l8 -6 v12 z" fill="${c}"/><circle cx="30" cy="24" r="2.6" fill="${dk}"/>`; break;
    case "marlin":
      body=`<path d="M30 30 C45 16,78 16,92 28 L98 22 L94 30 L98 38 L92 32 C78 44,45 44,30 30 Z" fill="${c}"/>
            <path d="M30 30 L0 22 L26 30 L0 38 Z" fill="${c}"/>
            <path d="M52 17 C56 9,64 8,70 12" stroke="${c}" stroke-width="3" fill="none"/>
            <circle cx="78" cy="27" r="2.4" fill="${dk}"/>`; break;
    case "tuna":
      body=`<path d="M6 30 C22 14,64 14,82 27 L98 16 L92 30 L98 44 L82 33 C64 46,22 46,6 30 Z" fill="${c}"/>
            <path d="M40 16 l5 -7 l3 8 z" fill="${c}"/><circle cx="22" cy="27" r="2.6" fill="${dk}"/>`; break;
    case "catfish":
      body=`<path d="M4 30 C22 18,58 18,80 28 L96 20 L90 30 L96 40 L80 32 C58 42,22 42,4 30 Z" fill="${c}"/>
            <circle cx="22" cy="27" r="2.4" fill="${dk}"/>
            <path d="M14 30 q-8 4 -14 2 M14 31 q-8 7 -15 8" stroke="${c}" stroke-width="1.6" fill="none"/>`; break;
    case "sturgeon":
      body=`<path d="M0 31 C24 22,60 22,86 28 L98 24 L94 31 L98 38 L86 34 C60 40,24 40,0 31 Z" fill="${c}"/>
            <path d="M10 24 L86 27" stroke="${dk}" stroke-width="1" opacity=".5"/>
            <circle cx="20" cy="29" r="2" fill="${dk}"/>`; break;
    default: // generic rounded gamefish
      body=`<path d="M4 30 C20 14,60 14,80 26 L98 16 L92 30 L98 44 L80 34 C60 46,20 46,4 30 Z" fill="${c}"/>
            <path d="M80 26 L98 16 L92 30 Z" fill="${c}"/>
            <circle cx="22" cy="27" r="2.6" fill="${dk}"/>
            <path d="M44 18 C50 24,50 36,44 42" stroke="${dk}" stroke-width="1" fill="none" opacity=".35"/>`;
  }
  return `<svg viewBox="0 0 100 60" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
function stars(n){ return "★★★★★".slice(0,n)+"☆☆☆☆☆".slice(0,5-n); }

/* ---------- rolodex render ---------- */
function renderList(){
  const list=document.getElementById("list"); const q=norm(state.query);
  const selStateNorm = state.selectedState?norm(state.selectedState):null;
  const selEcoNorm = state.selectedEco?norm(state.selectedEco):null;

  let items=FISH.filter(f=>{
    if(selEcoNorm && !fishEcoNorm(f).has(selEcoNorm)) return false;
    if(selStateNorm && !fishStatesNorm(f).has(selStateNorm)) return false;
    if(q){
      const hay=norm(f.name+" "+f.sci+" "+f.family+" "+f.baits.join(" ")+" "+(f.diet||"")+" "+
        (f.subs?f.subs.map(s=>s.n).join(" "):""));
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  const groups={}; items.forEach(f=>{ (groups[f.family]=groups[f.family]||[]).push(f); });
  list.innerHTML=""; let shown=0;

  Object.keys(groups).forEach(fam=>{
    // pre-eval to know if group has any visible
    const vis=groups[fam].map(f=>({f,ev:evalFish(f)})).filter(x=>x.ev.visible);
    if(!vis.length) return;
    const g=document.createElement("div"); g.className="grp";
    g.innerHTML=`<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${FAMILY_COLOR[fam]||'#5bbf9b'};margin-right:6px"></span>${fam} <span style="opacity:.6">(${vis.length})</span>`;
    list.appendChild(g);

    // sort by bite pct when angling
    if(state.angling) vis.sort((a,b)=>(b.ev.pct||0)-(a.ev.pct||0));

    vis.forEach(({f,ev})=>{
      shown++;
      const card=document.createElement("div");
      card.className="card"+(state.selectedFish===f.id?" sel":"")+(ev.rating==="slow"?" dim":"")+
        (state.selectedFish===f.id && f.subs?" open":"");
      card.dataset.id=f.id;

      let bite="";
      if(state.angling && ev.rating){
        const lbl=ev.rating==="peak"?`● Biting ${ev.pct}%`:ev.rating==="good"?`◐ Active ${ev.pct}%`:`○ Slow ${ev.pct}%`;
        bite=`<span class="bite ${ev.rating}">${lbl}</span>`;
      }
      const waterPills=f.water.slice(0,3).map(w=>`<span class="pill">${WATER_LABEL[w]||w}</span>`).join("");
      let subsHtml="";
      if(f.subs){ subsHtml=`<div class="subs">`+f.subs.map((s,i)=>
        `<div class="sub ${state.selectedFish===f.id&&state.selectedSub===i?'sel':''}" data-sub="${i}">
           <span class="sn">${s.n}</span><span class="ss">${s.s}</span></div>`).join("")+`</div>`; }

      card.innerHTML=`
        <div class="row1">
          <span class="thumb">${fishSVG(f.shape, FAMILY_COLOR[f.family])}</span>
          <div style="min-width:0;flex:1">
            <div class="nm">${f.name}</div>
            <div class="sci">${f.sci}</div>
          </div>
          ${bite}
        </div>
        <div class="meta">${waterPills}<span class="pill fight">${stars(f.fight)}</span>${f.subs?`<span class="pill">${f.subs.length} subsp.</span>`:""}</div>
        ${subsHtml}`;
      list.appendChild(card);
    });
  });

  if(shown===0){
    const where=state.selectedEco||state.selectedState;
    list.innerHTML=`<div style="padding:30px 16px;color:var(--muted);text-align:center">
      No fish match these filters.${where?`<br>Try clearing the <b>${where}</b> location.`:""}</div>`;
  }
  document.getElementById("count").textContent=shown+" / "+FISH.length+" species";
}

/* ---------- context bar ---------- */
function renderCtx(){
  const ctx=document.getElementById("ctx");
  if(state.selectedEco){
    ctx.innerHTML=`<span>Fish in the <b>${state.selectedEco}</b> ecoregion</span><button id="clearEco">Clear</button>`;
    document.getElementById("clearEco").onclick=()=>setSelectedEco(null);
  } else if(state.selectedState){
    ctx.innerHTML=`<span>Fish found in <b>${state.selectedState}</b></span><button id="clearState">Clear location</button>`;
    document.getElementById("clearState").onclick=()=>setSelectedState(null);
  } else if(state.selectedFish){
    const f=fishById(state.selectedFish);
    const sub=state.selectedSub!=null&&f.subs?" — "+f.subs[state.selectedSub].n:"";
    ctx.innerHTML=`<span>Range shown for <b>${f.name}${sub}</b></span><button id="clearFish">Show all</button>`;
    document.getElementById("clearFish").onclick=()=>selectFish(null);
  } else {
    ctx.innerHTML=`<span>Showing all North American game fish</span>`;
  }
}

/* ---------- map ---------- */
const HILITE={weight:1.2, color:"#0c2a22", fillColor:"#37b6a0", fillOpacity:.82};
const DIM={weight:.5, color:"#21404c", fillColor:"#11242c", fillOpacity:.32};
function styleState(name){
  const nn=norm(name);
  const base={weight:.8, color:"#2b4d59", fillColor:"#16323c", fillOpacity:.5};
  if(state.selectedFish){
    const f=fishById(state.selectedFish);
    const sts=new Set(fishHighlightStates(f, state.selectedSub).map(norm));
    return sts.has(nn) ? HILITE : DIM;
  }
  if(state.selectedEco) return DIM; // dim states so the ecoregion reads clearly
  if(state.selectedState && norm(state.selectedState)===nn)
    return {weight:2, color:"#5ad1bb", fillColor:"#26566b", fillOpacity:.85};
  return base;
}
function restyle(){
  for(const k in stateLayers) stateLayers[k].setStyle(styleState(stateLayers[k]._fdName));
  if(ecoLayer) ecoLayer.setStyle(styleEcoFeature);
}

function onEachState(feature, layer){
  const name=feature.properties.name || feature.properties.NAME || "—";
  layer._fdName=name;
  stateLayers[norm(name)]=layer; normIndex[norm(name)]=name;
  layer.bindTooltip(name,{className:"stt",sticky:true});
  layer.on({
    mouseover:e=>{ const s=styleState(name); e.target.setStyle({weight:2.2,color:"#5ad1bb",fillOpacity:Math.min(.95,s.fillOpacity+.15)}); e.target.bringToFront(); },
    mouseout:e=>e.target.setStyle(styleState(name)),
    click:()=>setSelectedState(name)
  });
}

function initMap(){
  map=L.map("map",{minZoom:2,maxZoom:8,zoomControl:true,worldCopyJump:true}).setView([44,-96],3);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{
    attribution:'&copy; OpenStreetMap, &copy; CARTO • boundaries: click_that_hood', subdomains:"abcd", maxZoom:8
  }).addTo(map);
  let loaded=0;
  GEO_SOURCES.forEach(src=>loadGeo(src.urls,0,()=>{ loaded++; if(loaded>=GEO_SOURCES.length){ document.getElementById("loading").style.display="none"; restyle(); }}));
}
function loadGeo(urls, i, done){
  if(i>=urls.length){ console.warn("FishDex: all sources failed for",urls[0]); done(); return; }
  fetch(urls[i]).then(r=>{ if(!r.ok) throw 0; return r.json(); })
    .then(geo=>{ L.geoJSON(geo,{style:f=>styleState(f.properties.name||f.properties.NAME),onEachFeature:onEachState}).addTo(map); done(); })
    .catch(()=>loadGeo(urls,i+1,done));
}

/* ---------- ecoregion layer (EPA Level III) ----------
   ecoData : parsed FeatureCollection (loaded once)
   ecoMode : toggle — interactive ecoregion filtering + colored overview
   The layer is shown when: ecoMode, or an ecoregion is selected, or a
   selected fish has ecoregion data. Interactive only in ecoMode, so
   state click-to-filter still works underneath otherwise. */
let ecoData=null, ecoLayer=null, ecoMode=false, ecoLoading=false;
const ECO_PALETTE=["#caa24a","#6fae54","#5aa9d6","#cf8f6f","#9b7fd1","#5ec2a0","#d6a05a","#88909e","#c77f9e","#7bb25e","#bf6f6f","#5a86d6"];
const ECO_L1_COLOR={};
function ecoColor(name){ name=name||"—"; if(!(name in ECO_L1_COLOR)) ECO_L1_COLOR[name]=ECO_PALETTE[Object.keys(ECO_L1_COLOR).length%ECO_PALETTE.length]; return ECO_L1_COLOR[name]; }
function ecoBandStyle(f){ const c=ecoColor(f&&f.properties&&f.properties.NA_L1NAME); return {color:c,weight:.5,fillColor:c,fillOpacity:.18}; }
const ECO_HIDE={color:"#000",weight:0,fillColor:"#000",fillOpacity:0};
function styleEcoFeature(f){
  const nn=norm(f&&f.properties&&f.properties.US_L3NAME);
  if(state.selectedFish){
    const fish=fishById(state.selectedFish);
    if(usesEco(fish,state.selectedSub)){
      return fishEcoNorm(fish,state.selectedSub).has(nn)
        ? {color:"#0c2a22",weight:.8,fillColor:"#37b6a0",fillOpacity:.8}
        : (ecoMode?ecoBandStyle(f):ECO_HIDE);
    }
    return ecoMode?ecoBandStyle(f):ECO_HIDE;
  }
  if(state.selectedEco){
    return norm(state.selectedEco)===nn
      ? {color:"#5ad1bb",weight:1.6,fillColor:"#37b6a0",fillOpacity:.72}
      : (ecoMode?ecoBandStyle(f):ECO_HIDE);
  }
  return ecoMode?ecoBandStyle(f):ECO_HIDE;
}
function onEachEco(feature, layer){
  const nm=feature.properties&&feature.properties.US_L3NAME;
  layer.bindTooltip(nm||"Ecoregion",{className:"eco",sticky:true});
  layer.on("click",()=>setSelectedEco(nm));
}
function buildEcoLayer(){
  if(!ecoData) return;
  ecoLayer=L.geoJSON(ecoData,{interactive:ecoMode, style:styleEcoFeature, onEachFeature: ecoMode?onEachEco:undefined});
}
// decide presence + (re)build the eco layer to match current selection/mode
function refreshEco(){
  const show = ecoMode || state.selectedEco || (state.selectedFish && usesEco(fishById(state.selectedFish), state.selectedSub));
  if(ecoLayer){ map.removeLayer(ecoLayer); ecoLayer=null; }
  if(show && ecoData){ buildEcoLayer(); ecoLayer.addTo(map); ecoLayer.bringToFront(); }
}
function loadEcoData(urls,i,cb){
  if(i>=urls.length){ cb(false); return; }
  fetch(urls[i]).then(r=>r.ok?r.json():Promise.reject()).then(geo=>{ ecoData=geo; cb(true); }).catch(()=>loadEcoData(urls,i+1,cb));
}
function preloadEco(){ if(!ecoData && !ecoLoading){ ecoLoading=true; loadEcoData(ECOREGION_SOURCES,0,(ok)=>{ ecoLoading=false; if(ok){ refreshEco(); restyle(); } }); } }
function toggleEcoMode(){
  const btn=document.getElementById("ecoBtn");
  const setBtn=(on,txt)=>{ btn.classList.toggle("on",on); btn.textContent="🗺️ "+(txt||("Ecoregions: "+(on?"on":"off"))); };
  const hint=document.getElementById("hint");
  if(!ecoData){
    setBtn(false,"Ecoregions: loading…");
    loadEcoData(ECOREGION_SOURCES,0,(ok)=>{ if(ok){ ecoMode=true; setBtn(true); hint.textContent="Ecoregion mode: click an ecoregion to see its fish."; refreshEco(); restyle(); }
      else { setBtn(false,"Ecoregions: unavailable"); setTimeout(()=>setBtn(false),2600); } });
    return;
  }
  ecoMode=!ecoMode; setBtn(ecoMode);
  hint.textContent = ecoMode ? "Ecoregion mode: click an ecoregion to see its fish."
                             : "Tip: click any state, province, or Mexican state to see what swims there.";
  refreshEco(); restyle();
}

/* ---------- notable waters (named-waterbody pins) ---------- */
let waterLayer=L.layerGroup(), waterMarkers={};
function watersToShow(){
  if(state.selectedFish) return (typeof WATERS!=="undefined"?WATERS:[]).filter(w=>w.species.includes(state.selectedFish));
  if(state.selectedState) return (typeof WATERS!=="undefined"?WATERS:[]).filter(w=>w.region===state.selectedState);
  return [];
}
function makeWaterPopup(w){
  const t=WATER_TYPE[w.type]||{label:w.type,color:"#888"};
  const el=document.createElement("div"); el.className="wpop";
  el.innerHTML=`<div class="wph"><span class="wdot" style="background:${t.color}"></span><b>${w.name}</b></div>
    <div class="wtype">${t.label} · ${w.region}${w.depth?` · <span style="color:#9fd8d2">${w.depth}</span>`:""}</div>
    <div class="wnote">${w.note}</div>
    ${w.best?`<div class="wmeta"><b>Best</b> ${w.best}</div>`:""}
    ${w.how?`<div class="wmeta"><b>How</b> ${w.how}</div>`:""}
    ${w.size?`<div class="wmeta"><b>Where</b> ${w.size}</div>`:""}
    <div class="wsp">${w.species.map(id=>{const f=fishById(id);return f?`<span class="wchip" data-fid="${id}">${f.name}</span>`:"";}).join("")}</div>`;
  el.querySelectorAll(".wchip").forEach(c=>c.addEventListener("click",()=>selectFish(c.dataset.fid)));
  return el;
}
function refreshWaters(){
  waterLayer.clearLayers(); waterMarkers={};
  watersToShow().forEach(w=>{
    const t=WATER_TYPE[w.type]||{color:"#888"};
    // HTML divIcon marker -> lives in markerPane, above all polygons (so state/eco
    // hover bringToFront can't paint over it).
    const icon=L.divIcon({className:"wpin", html:`<span style="background:${t.color}"></span>`, iconSize:[18,18], iconAnchor:[9,9], popupAnchor:[0,-8]});
    const m=L.marker([w.lat,w.lon],{icon, riseOnHover:true, title:w.name});
    m.bindPopup(()=>makeWaterPopup(w),{maxWidth:260,className:"wpopwrap"});
    m.bindTooltip(w.name,{direction:"top",offset:[0,-9]});
    m.addTo(waterLayer); waterMarkers[w.name]=m;
  });
  if(map && !map.hasLayer(waterLayer)) waterLayer.addTo(map);
}

/* ---------- info card ---------- */
const photoCache={};
function loadPhoto(f, imgEl, creditEl){
  const title=(typeof WIKI!=="undefined")?WIKI[f.id]:null; if(!title||!imgEl) return;
  const apply=(o)=>{ if(!o||!o.src) return; imgEl.onload=()=>{imgEl.style.display="block";}; imgEl.src=o.src; if(creditEl&&o.credit) creditEl.textContent=o.credit; };
  if(photoCache[f.id]!==undefined){ apply(photoCache[f.id]); return; }
  fetch("https://en.wikipedia.org/api/rest_v1/page/summary/"+encodeURIComponent(title))
    .then(r=>r.ok?r.json():Promise.reject())
    .then(d=>{
      let src=(d.thumbnail&&d.thumbnail.source)||(d.originalimage&&d.originalimage.source)||null;
      if(src) src=src.replace(/\/\d+px-/,"/500px-");
      const o = src?{src,credit:"Photo: Wikipedia / "+(d.title||title)}:null;
      photoCache[f.id]=o; apply(o);
    }).catch(()=>{ photoCache[f.id]=null; });
}
function renderInfo(){
  const box=document.getElementById("info");
  if(state.selectedFish){ renderFishInfo(box); box.classList.add("show"); return; }
  if(state.selectedEco){ renderEcoInfo(box); box.classList.add("show"); return; }
  if(state.selectedState){ renderStateInfo(box); box.classList.add("show"); return; }
  box.classList.remove("show");
}
function renderEcoInfo(box){
  const name=state.selectedEco;
  const here=FISH.filter(f=>fishEcoNorm(f).has(norm(name)));
  let l1="";
  if(ecoData){ const ft=ecoData.features.find(f=>norm(f.properties.US_L3NAME)===norm(name)); if(ft) l1=(ft.properties.NA_L1NAME||"").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()); }
  const pills=here.map(f=>`<span class="pill" data-fid="${f.id}">${f.name}</span>`).join("")
    ||'<span style="color:var(--muted);font-size:12px">No freshwater species tagged here yet.</span>';
  box.innerHTML=`<div class="pad">
    <div class="ihead"><span style="font-size:22px">🗺️</span><div><h3>${name}</h3>
      <div class="sci">EPA Level III ecoregion${l1?" · "+l1:""}</div></div></div>
    <div class="kv">${here.length} freshwater species tagged to this ecoregion.</div>
    <div class="kv" style="margin-top:8px"><b>Species here</b> <span style="color:var(--muted)">(tap to view range)</span></div>
    <div class="speclist">${pills}</div>
    <div class="disclaimer">Ecoregion ranges are curated approximations for freshwater fish. Marine species and Alaska/Hawaii/Canada/Mexico stay state-level.</div>
  </div>`;
  box.querySelectorAll(".speclist .pill[data-fid]").forEach(p=>p.onclick=()=>selectFish(p.dataset.fid));
}
function renderFishInfo(box){
  const f=fishById(state.selectedFish);
  const sub=state.selectedSub!=null&&f.subs?f.subs[state.selectedSub]:null;
  const months=f.bestMonths.map(m=>MONTHS[m-1].slice(0,3)).join(", ");
  const tod=f.tod.map(t=>TOD_LABEL[t]).join(", ");
  box.innerHTML=`
    <img class="hero" alt="${f.name}">
    <div class="pad">
      <div class="ihead">
        <span class="iart">${fishSVG(f.shape,FAMILY_COLOR[f.family],60)}</span>
        <div><h3>${f.name}${sub?` <span class="subname">(${sub.n})</span>`:""}</h3>
        <div class="sci">${sub?sub.s:f.sci}</div></div>
      </div>
      <div class="kv"><b>Family:</b> ${f.family} &nbsp;·&nbsp; <b>Fight:</b> <span class="stars">${stars(f.fight)}</span></div>
      <div class="kv"><b>Habitat:</b> ${f.habitat}</div>
      <div class="kv"><b>Diet:</b> ${f.diet}</div>
      <div class="kv"><b>Best months:</b> ${months} &nbsp;·&nbsp; <b>Time:</b> ${tod}</div>
      <div class="kv"><b>Water temp:</b> ${f.tempF} &nbsp;·&nbsp; <b>World record:</b> ${f.record} lb</div>
      ${f.tide?`<div class="kv"><b>Tide / solunar:</b> ${f.tide}</div>`:""}
      <div class="kv"><b>Regs:</b> <span style="color:var(--warn)">${f.regs}</span> <span style="color:var(--muted)">— click a state for official limits.</span></div>
      <div class="kv"><b>Tip:</b> ${f.tip}</div>
      <div class="kv" style="margin-top:6px"><b>What they're biting:</b></div>
      <div class="baits">${f.baits.map(b=>`<span class="pill">${b}</span>`).join("")}</div>
      ${waterChipsHtml(f)}
      <div class="credit"></div>
    </div>`;
  loadPhoto(f, box.querySelector(".hero"), box.querySelector(".credit"));
  box.querySelectorAll(".waterchip").forEach(c=>c.onclick=()=>{
    const m=waterMarkers[c.dataset.w]; if(m){ map.setView(m.getLatLng(),9,{animate:true}); m.openPopup(); }
  });
}
function waterChipsHtml(f){
  const ws=(typeof WATERS!=="undefined"?WATERS:[]).filter(w=>w.species.includes(f.id));
  if(!ws.length) return "";
  const regions=[...new Set(ws.map(w=>w.region))].join(" & ");
  return `<div class="kv" style="margin-top:8px"><b>Notable waters</b> <span style="color:var(--muted)">(${regions} — tap to zoom)</span></div>
    <div class="waters">${ws.map(w=>`<span class="waterchip" data-w="${w.name}">📍 ${w.name}</span>`).join("")}</div>`;
}
function renderStateInfo(box){
  const name=state.selectedState;
  const here=FISH.filter(f=>fishStatesNorm(f).has(norm(name)));
  const reg = STATE_REGS[name] || (typeof MX_STATES!=="undefined"&&MX_STATES.has(name)?MX_REGS:null);
  const pills=here.slice(0,48).map(f=>`<span class="pill" data-fid="${f.id}">${f.name}</span>`).join("")
    ||'<span style="color:var(--muted);font-size:12px">No species in this guide yet for here.</span>';
  box.innerHTML=`<div class="pad">
    <div class="ihead"><span style="font-size:22px">📍</span><div><h3>${name}</h3>
      <div class="sci">${here.length} game species in this guide</div></div></div>
    ${reg?`<div class="kv"><b>Official source:</b> ${reg.agency}</div>
      <a class="reglink" href="${reg.url}" target="_blank" rel="noopener noreferrer">📋 Regulations & licenses ↗</a>
      <div class="disclaimer">Bag, size & season limits change yearly and vary by waterbody — always confirm current rules on the official site before you fish.</div>`
     :`<div class="kv" style="color:var(--muted)">No official-source link on file for this region yet.</div>`}
    <div class="kv" style="margin-top:10px"><b>Species found here</b> <span style="color:var(--muted)">(tap to view range)</span></div>
    <div class="speclist">${pills}</div>
  </div>`;
  box.querySelectorAll(".speclist .pill[data-fid]").forEach(p=>p.onclick=()=>selectFish(p.dataset.fid));
}

/* ---------- selection ---------- */
function selectFish(id, subIdx=null){
  if(state.selectedFish===id && state.selectedSub===subIdx && id!==null){ state.selectedFish=null; state.selectedSub=null; }
  else { state.selectedFish=id; state.selectedSub=subIdx; if(id){ state.selectedState=null; state.selectedEco=null; } }
  refreshEco(); refreshWaters(); restyle(); renderInfo(); renderList(); renderCtx();
  if(id){
    const f=fishById(id); const b=L.latLngBounds([]);
    fishHighlightStates(f,subIdx).map(norm).forEach(n=>{ const ly=stateLayers[n]; if(ly){ try{ b.extend(ly.getBounds()); }catch(e){} } });
    if(usesEco(f,subIdx) && ecoLayer){ const set=fishEcoNorm(f,subIdx); ecoLayer.eachLayer(l=>{ if(l.feature && set.has(norm(l.feature.properties.US_L3NAME))){ try{ b.extend(l.getBounds()); }catch(e){} } }); }
    if(b.isValid()){ try{ map.fitBounds(b.pad(0.12),{maxZoom:6,animate:true}); }catch(e){} }
  }
}
function setSelectedState(name){
  state.selectedState=(state.selectedState===name)?null:name;
  if(state.selectedState){ state.selectedFish=null; state.selectedSub=null; state.selectedEco=null; }
  refreshEco(); refreshWaters(); renderInfo(); restyle(); renderList(); renderCtx();
}
function setSelectedEco(name){
  state.selectedEco=(state.selectedEco===name)?null:name;
  if(state.selectedEco){ state.selectedFish=null; state.selectedSub=null; state.selectedState=null; }
  refreshEco(); refreshWaters(); renderInfo(); restyle(); renderList(); renderCtx();
  if(state.selectedEco && ecoLayer){
    let lyr=null; ecoLayer.eachLayer(l=>{ if(l.feature && norm(l.feature.properties.US_L3NAME)===norm(state.selectedEco)) lyr=l; });
    if(lyr){ try{ map.fitBounds(lyr.getBounds().pad(0.25),{maxZoom:6,animate:true}); }catch(e){} }
  }
}

/* ---------- filters UI ---------- */
function buildFilterUI(){
  const monthSel=document.getElementById("month");
  MONTHS.forEach((m,i)=>{ const o=document.createElement("option"); o.value=i+1; o.textContent=m; monthSel.appendChild(o); });
  monthSel.onchange=()=>{ state.month=monthSel.value; renderList(); };

  document.getElementById("nowBtn").onclick=()=>{
    const m=new Date().getMonth()+1; state.month=String(m); monthSel.value=m;
    const hr=new Date().getHours();
    const t = hr<7?"dawn":hr<11?"morning":hr<14?"midday":hr<17?"afternoon":hr<20?"dusk":"night";
    state.tod=new Set([t]);
    document.querySelectorAll('#tod button').forEach(b=>b.classList.toggle("on",b.dataset.k===t));
    if(!state.angling) document.getElementById("angleToggle").click();
    renderList();
  };

  const todBox=document.getElementById("tod");
  TOD_ORDER.forEach(t=>{ const b=document.createElement("button"); b.textContent=TOD_LABEL[t]; b.dataset.k=t;
    b.onclick=()=>{ b.classList.toggle("on"); state.tod.has(t)?state.tod.delete(t):state.tod.add(t); renderList(); }; todBox.appendChild(b); });

  const waterBox=document.getElementById("water");
  Object.keys(WATER_LABEL).forEach(w=>{ const b=document.createElement("button"); b.textContent=WATER_LABEL[w]; b.dataset.k=w;
    b.onclick=()=>{ b.classList.toggle("on"); state.water.has(w)?state.water.delete(w):state.water.add(w); renderList(); }; waterBox.appendChild(b); });

  document.getElementById("ecoBtn").onclick=toggleEcoMode;

  const tgl=document.getElementById("angleToggle");
  tgl.onclick=()=>{ state.angling=!state.angling; tgl.classList.toggle("on",state.angling);
    document.getElementById("angleFilters").classList.toggle("hide",!state.angling);
    document.getElementById("hint").textContent=state.angling?"Set month & time to rank what's biting now.":"Tip: click any state, province, or Mexican state to see what swims there.";
    renderList(); };
}
function renderLegend(){
  document.getElementById("legend").innerHTML=`
    <div><i style="background:#37b6a0"></i>Selected range (state or ecoregion)</div>
    <div><i style="background:#26566b"></i>Clicked location</div>
    <div><i style="background:#16323c"></i>Other states / provinces</div>
    <div><i style="background:#7cc0e0;border-radius:50%"></i>📍 Notable water (tap pin)</div>
    <div style="margin-top:3px;font-size:10px;opacity:.7">US freshwater fish show ecoregion ranges</div>`;
}

/* ---------- events ---------- */
function wireList(){
  document.getElementById("list").addEventListener("click",e=>{
    const subEl=e.target.closest(".sub"); const card=e.target.closest(".card");
    if(subEl&&card){ selectFish(card.dataset.id,+subEl.dataset.sub); return; }
    if(card) selectFish(card.dataset.id);
  });
  const q=document.getElementById("q"); q.addEventListener("input",()=>{ state.query=q.value; renderList(); });
}

window.addEventListener("DOMContentLoaded",()=>{
  buildFilterUI(); wireList(); renderLegend(); renderList(); renderCtx(); initMap();
  setTimeout(preloadEco, 1200); // warm the ecoregion data so fish ranges render instantly
});
