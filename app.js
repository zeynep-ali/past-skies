// ---- ANALYTICS ----
const SESSION_ID=(()=>{
  let id=sessionStorage.getItem('ps_sid');
  if(!id){id=crypto.randomUUID();sessionStorage.setItem('ps_sid',id);}
  return id;
})();
function track(event, props){
  fetch('https://analytics.past-skies.com/', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({event, session_id:SESSION_ID, props:props||undefined}),
  }).catch(()=>{});
}
window.addEventListener('appinstalled',()=>track('pwa_install'));

const WMO={0:['☀️','Clear sky'],1:['🌤','Mainly clear'],2:['⛅','Partly cloudy'],3:['☁️','Overcast'],45:['🌫','Foggy'],48:['🌫','Icy fog'],51:['🌦','Light drizzle'],53:['🌦','Drizzle'],55:['🌧','Heavy drizzle'],61:['🌧','Light rain'],63:['🌧','Rain'],65:['🌧','Heavy rain'],71:['🌨','Light snow'],73:['❄️','Snow'],75:['❄️','Heavy snow'],77:['🌨','Snow grains'],80:['🌦','Showers'],81:['🌧','Heavy showers'],82:['⛈','Violent showers'],85:['🌨','Snow showers'],86:['❄️','Heavy snow showers'],95:['⛈','Thunderstorm'],96:['⛈','Stormy & hail'],99:['⛈','Severe storm']};
function wmo(c){return WMO[c]||['🌡','Unknown'];}

// Night icon remapping: for codes that mean "clear/few clouds" during the day,
// substitute night-appropriate icons when the hour falls after sunset or before sunrise
const NIGHT_REMAP={
  0:['🌙','Clear sky'],
  1:['🌙','Mainly clear'],
  2:['☁️','Partly cloudy'],
  3:['☁️','Overcast'],
  80:['🌧️','Showers'],
  81:['🌧️','Heavy showers'],
  51:['🌧️','Light drizzle'],
  53:['🌧️','Drizzle'],
};

function wmoForHour(code, dtMs, daily){
  // Find the sunrise/sunset for the day this hour falls on
  const _d=new Date(dtMs);
  const dateStr=_d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
  const dayIdx=daily.time.indexOf(dateStr);
  if(dayIdx===-1) return wmo(code);
  const sunrise=daily.sunrise?.[dayIdx];
  const sunset=daily.sunset?.[dayIdx];
  if(!sunrise||!sunset) return wmo(code);
  const sunriseMs=new Date(sunrise).getTime();
  const sunsetMs=new Date(sunset).getTime();
  const isNight=dtMs<sunriseMs||dtMs>sunsetMs;
  if(isNight&&NIGHT_REMAP[code]) return NIGHT_REMAP[code];
  return wmo(code);
}

let FAH=true,rawData=null;
const c2f=c=>c*9/5+32;
const ft=c=>c==null?'—':FAH?Math.round(c2f(c))+'°F':Math.round(c)+'°C';
const fn=c=>c==null?'—':(FAH?Math.round(c2f(c)):Math.round(c));

function updateToggleUI(){
  document.getElementById('opt-f').className='unit-opt'+(FAH?' active':'');
  document.getElementById('opt-c').className='unit-opt'+(!FAH?' active':'');
}
function toggleUnit(){
  FAH=!FAH;
  track('unit_toggle',{unit:FAH?'F':'C'});
  updateToggleUI();
  if(rawData){renderMain(rawData);renderChart(rawData);renderPrecipChart(rawData);}
}

function localISO(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function todayISO(){return localISO(new Date());}
function offsetISO(n){const d=new Date();d.setDate(d.getDate()+n);return localISO(d);}
function dayS(iso){return new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'});}
function monD(iso){return new Date(iso+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function fmt12(h){return(h%12||12)+(h>=12?' pm':' am');}
function setStatus(t){const e=document.getElementById('lstatus');if(e)e.textContent=t;}

function renderAll(data){
  rawData=data;
  renderMain(data);
  renderChart(data);
  renderPrecipChart(data);
  // Fog monster — shows if fog in today's forecast OR any historical point was >4°F off
  if(data.lat&&data.lon&&isBayArea(data.lat,data.lon)){
    const nowMs=Date.now();
    const todayMidnight=new Date(); todayMidnight.setHours(23,59,59,999);
    let isFoggy=false;
    data.hourly.time.forEach((t,i)=>{
      const ms=new Date(t).getTime();
      if(ms>=nowMs&&ms<=todayMidnight.getTime()){
        const wc=data.hourly.weathercode?.[i]??0;
        if(wc===45||wc===48) isFoggy=true;
      }
    });
    const maxErrorC=calcForecastMaxError(data.hourly,data.histFc);
    const hasLargeError=maxErrorC!=null&&(maxErrorC*9/5)>4;
    if(isFoggy||hasLargeError){
      setTimeout(()=>spawnFogMonster(isFoggy,hasLargeError?maxErrorC:null),1500);
    }
  }
}

function renderPrecipChart(data){
  const{hourly,histFc}=data;
  const outer=document.getElementById('precip-outer');
  const body=document.getElementById('precip-body');
  const note=document.getElementById('precip-note');
  if(!outer||!body)return;

  const nowMs=Date.now();
  const startMs=nowMs-12*3600000;
  const endMs=nowMs+12*3600000;

  // Actual precipitation from main API
  const actualPts=[];
  hourly.time.forEach((t,i)=>{
    const ms=new Date(t).getTime();
    if(ms>=startMs&&ms<=endMs){
      actualPts.push({ms,val:hourly.precipitation?.[i]||0});
    }
  });

  // GFS past precipitation from historical API
  const gfsPastPts=[];
  if(histFc&&histFc.precipitation){
    histFc.time.forEach((t,i)=>{
      const ms=new Date(t).getTime();
      if(ms>=startMs&&ms<=nowMs){
        gfsPastPts.push({ms,val:histFc.precipitation[i]||0});
      }
    });
  }
  // GFS future precipitation from main API
  const gfsFuturePts=[];
  hourly.time.forEach((t,i)=>{
    const ms=new Date(t).getTime();
    if(ms>nowMs&&ms<=endMs){
      gfsFuturePts.push({ms,val:hourly.precipitation?.[i]||0});
    }
  });
  const gfsPts=[...gfsPastPts,...gfsFuturePts];

  const maxActual=Math.max(...actualPts.map(p=>p.val),0);
  const maxGfs=Math.max(...gfsPts.map(p=>p.val),0);
  const maxP=Math.max(maxActual,maxGfs);

  if(maxP<0.05){outer.style.display='none';return;}
  outer.style.display='block';

  const W=400,H=90,PL=34,PR=8,PT=8,PB=20;
  const cW=W-PL-PR,cH=H-PT-PB;
  const xS=ms=>PL+((ms-startMs)/(endMs-startMs))*cW;
  const yS=v=>PT+cH-(v/maxP)*cH;
  const nowX=xS(nowMs).toFixed(1);
  const bW=Math.max(4,(cW/25)*0.55);

  const timeTicks=[-12,-6,0,6,12].map(h=>({
    ms:nowMs+h*3600000,
    label:h===0?'now':fmt12(new Date(nowMs+h*3600000).getHours()),
    isNow:h===0
  }));

  // Y axis: 2 ticks
  const yMid=maxP/2;
  const yTicks=[yMid,maxP];

  let bars='';
  // GFS bars (behind, outlined pink)
  gfsPts.forEach(p=>{
    if(p.val<0.01)return;
    const x=xS(p.ms);
    const barH=((p.val/maxP)*cH);
    const y=PT+cH-barH;
    bars+=`<rect x="${(x-bW+1).toFixed(1)}" y="${y.toFixed(1)}" width="${bW.toFixed(1)}" height="${barH.toFixed(1)}" fill="rgba(220,100,160,0.12)" stroke="rgba(220,100,160,0.7)" stroke-width="1" rx="1"/>`;
  });
  // Actual bars (front, solid teal)
  actualPts.forEach(p=>{
    if(p.val<0.01)return;
    const x=xS(p.ms);
    const barH=((p.val/maxP)*cH);
    const y=PT+cH-barH;
    bars+=`<rect x="${(x-bW+1).toFixed(1)}" y="${y.toFixed(1)}" width="${bW.toFixed(1)}" height="${barH.toFixed(1)}" fill="#4dd9c0" rx="1"/>`;
  });

  body.innerHTML=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
    <line x1="${PL}" y1="${PT+cH}" x2="${W-PR}" y2="${PT+cH}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
    ${yTicks.map(v=>`
      <line x1="${PL}" y1="${yS(v).toFixed(1)}" x2="${W-PR}" y2="${yS(v).toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
      <text x="${PL-4}" y="${(yS(v)+3).toFixed(1)}" fill="rgba(255,255,255,0.2)" font-size="7" text-anchor="end">${v.toFixed(1)}</text>
    `).join('')}
    <line x1="${nowX}" y1="${PT}" x2="${nowX}" y2="${H-PB}" stroke="rgba(232,184,109,0.35)" stroke-width="1" stroke-dasharray="3,3"/>
    ${bars}
    <text x="${PL-4}" y="${PT+cH+3}" fill="rgba(255,255,255,0.2)" font-size="7" text-anchor="end">0</text>
    <text x="${PL-10}" y="${(PT+cH/2).toFixed(1)}" fill="rgba(255,255,255,0.18)" font-size="7" text-anchor="middle" transform="rotate(-90,${PL-10},${(PT+cH/2).toFixed(1)})">mm</text>
    ${timeTicks.map(t=>`<text x="${xS(t.ms).toFixed(1)}" y="${H-PB+13}" fill="${t.isNow?'rgba(232,184,109,0.85)':'rgba(255,255,255,0.2)'}" font-size="7.5" text-anchor="middle">${t.label}</text>`).join('')}
  </svg>`;

  const hasPastGFS=gfsPastPts.some(p=>p.val>0.01);
  note.textContent=hasPastGFS?'Teal = recorded rain · Pink = what GFS predicted':'GFS past forecast unavailable';
}

function renderChart(data){
  const{hourly,histFc}=data;
  const body=document.getElementById('chart-body');
  const note=document.getElementById('chart-note');
  if(!body)return;

  const nowMs=Date.now();
  const startMs=nowMs-12*3600000;
  const endMs=nowMs+12*3600000;

  // ACTUAL line: model analysis from main API (past hours only — solid teal)
  const actualPts=[];
  hourly.time.forEach((t,i)=>{
    const ms=new Date(t).getTime();
    if(ms>=startMs&&ms<=nowMs){
      const temp=hourly.temperature_2m[i];
      if(temp!=null) actualPts.push({ms,temp});
    }
  });

  // GFS FORECAST past: historical forecast API (what was predicted for those hours)
  const gfsPastPts=[];
  if(histFc){
    histFc.time.forEach((t,i)=>{
      const ms=new Date(t).getTime();
      if(ms>=startMs&&ms<=nowMs){
        const temp=histFc.temperature_2m[i];
        if(temp!=null) gfsPastPts.push({ms,temp});
      }
    });
    console.log('GFS past points in window:',gfsPastPts.length);
  }

  // GFS FORECAST future: from main API (what the model predicts going forward)
  const gfsFuturePts=[];
  hourly.time.forEach((t,i)=>{
    const ms=new Date(t).getTime();
    if(ms>nowMs&&ms<=endMs){
      const temp=hourly.temperature_2m[i];
      if(temp!=null) gfsFuturePts.push({ms,temp});
    }
  });

  // Stitch: nowActual bridges the two GFS segments at the now point
  const nowActual=actualPts.length?actualPts[actualPts.length-1]:null;

  const allT=[...actualPts,...gfsPastPts,...gfsFuturePts]
    .map(p=>FAH?c2f(p.temp):p.temp).filter(v=>!isNaN(v));
  if(!allT.length){body.innerHTML='<div class="chart-loading">No data in window</div>';return;}

  const minT=Math.min(...allT)-1.5, maxT=Math.max(...allT)+1.5;

  const W=400,H=110,PL=30,PR=8,PT=10,PB=20;
  const cW=W-PL-PR, cH=H-PT-PB;
  const xS=ms=>PL+((ms-startMs)/(endMs-startMs))*cW;
  const yS=t=>PT+(1-((FAH?c2f(t):t)-minT)/(maxT-minT))*cH;
  const nowX=parseFloat(xS(nowMs).toFixed(1));

  const mkPath=pts=>pts.length<2?'':
    pts.map((p,i)=>`${i===0?'M':'L'}${xS(p.ms).toFixed(1)},${yS(p.temp).toFixed(1)}`).join(' ');

  // Y axis ticks
  const spread=maxT-minT;
  const step=spread>12?4:spread>6?2:1;
  const tickStart=Math.ceil(minT/step)*step;
  const yTicks=[];
  for(let t=tickStart;t<=maxT;t+=step) yTicks.push(t);

  // Time axis
  const timeTicks=[-12,-6,0,6,12].map(h=>({
    ms:nowMs+h*3600000,
    label:h===0?'now':fmt12(new Date(nowMs+h*3600000).getHours()),
    isNow:h===0
  }));

  const hasPastGFS=gfsPastPts.length>1;

  // Build bridged GFS line: past → now point → future
  const nowBridge=nowActual?[{ms:nowMs,temp:nowActual.temp}]:[];
  const gfsFullPts=[...gfsPastPts,...nowBridge,...gfsFuturePts];

  body.innerHTML=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
    ${yTicks.map(t=>`
      <line x1="${PL}" y1="${yS(FAH?c2f(t):t).toFixed(1)}" x2="${W-PR}" y2="${yS(FAH?c2f(t):t).toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
      <text x="${PL-4}" y="${(yS(FAH?c2f(t):t)+3).toFixed(1)}" fill="rgba(255,255,255,0.22)" font-size="7.5" text-anchor="end">${Math.round(FAH?c2f(t):t)}°</text>
    `).join('')}
    <line x1="${nowX}" y1="${PT-2}" x2="${nowX}" y2="${H-PB+2}" stroke="rgba(232,184,109,0.35)" stroke-width="1" stroke-dasharray="3,3"/>
    ${gfsFuturePts.length>1?`<path d="M${xS(nowMs).toFixed(1)},${nowActual?yS(nowActual.temp).toFixed(1):yS(gfsFuturePts[0].temp).toFixed(1)} ${gfsFuturePts.map(p=>`L${xS(p.ms).toFixed(1)},${yS(p.temp).toFixed(1)}`).join(' ')}" stroke="rgba(220,100,160,0.45)" stroke-width="1.5" fill="none" stroke-dasharray="4,3"/>` :''}
    ${hasPastGFS?`<path d="${mkPath(gfsPastPts)}${nowBridge.length?` L${xS(nowMs).toFixed(1)},${yS(nowBridge[0].temp).toFixed(1)}`:''}" stroke="rgba(220,100,160,0.85)" stroke-width="1.5" fill="none" stroke-dasharray="4,3"/>`:''}
    ${actualPts.length>1?`
      <path d="${mkPath(actualPts)} L${xS(actualPts[actualPts.length-1].ms).toFixed(1)},${H-PB} L${xS(actualPts[0].ms).toFixed(1)},${H-PB}Z" fill="rgba(77,217,192,0.07)"/>
      <path d="${mkPath(actualPts)}" stroke="#4dd9c0" stroke-width="2" fill="none"/>
    `:''}
    ${nowActual?`<circle cx="${xS(nowActual.ms).toFixed(1)}" cy="${yS(nowActual.temp).toFixed(1)}" r="3.5" fill="#e8b86d" stroke="rgba(8,13,24,0.6)" stroke-width="1.5"/>`:''}
    ${timeTicks.map(t=>`<text x="${xS(t.ms).toFixed(1)}" y="${H-PB+13}" fill="${t.isNow?'rgba(232,184,109,0.85)':'rgba(255,255,255,0.2)'}" font-size="7.5" text-anchor="middle">${t.label}</text>`).join('')}
  </svg>`;

  note.textContent=hasPastGFS
    ?'Pink dashed = what GFS forecast · Teal = what actually happened'
    :'Historical GFS forecast unavailable — showing future forecast only';
}

function renderMain(data){
  const{daily,hourly}=data;
  const tod=todayISO(),yest=offsetISO(-1);

  /* ---- Yesterday hero ---- */
  const yi=daily.time.indexOf(yest);
  const si=yi>=0?yi:Math.max(0,daily.time.findIndex(t=>t>=tod)-1);
  const yMax=daily.temperature_2m_max[si],yMin=daily.temperature_2m_min[si],yAvg=(yMax+yMin)/2;
  const[yIc,yDs]=wmo(daily.weathercode[si]);
  const yPr=daily.precipitation_sum[si]||0,yWi=daily.windspeed_10m_max[si]||0;
  document.getElementById('yt').textContent=fn(yAvg);
  document.getElementById('yu').textContent=FAH?'°F':'°C';
  document.getElementById('yi').textContent=yIc;
  document.getElementById('yd').textContent=yDs;
  document.getElementById('y-range').textContent=`${ft(yMax)} / ${ft(yMin)}`;
  document.getElementById('y-precip').textContent=`${yPr.toFixed(1)} mm`;
  document.getElementById('y-wind').textContent=`${Math.round(yWi)} km/h`;

  /* ---- Today forecast hero ---- */
  const ti=daily.time.indexOf(tod);
  if(ti>=0){
    const tMax=daily.temperature_2m_max[ti],tMin=daily.temperature_2m_min[ti],tAvg=(tMax+tMin)/2;
    const[tIc,tDs]=wmo(daily.weathercode[ti]);
    const tPr=daily.precipitation_sum[ti]||0,tWi=daily.windspeed_10m_max[ti]||0;
    document.getElementById('td-temp').textContent=fn(tAvg);
    document.getElementById('td-unit').textContent=FAH?'°F':'°C';
    document.getElementById('td-icon').textContent=tIc;
    document.getElementById('td-cond').textContent=tDs;
    document.getElementById('td-range').textContent=`${ft(tMax)} / ${ft(tMin)}`;
    document.getElementById('td-precip').textContent=`${tPr.toFixed(1)} mm`;
    document.getElementById('td-wind').textContent=`${Math.round(tWi)} km/h`;
  }

  /* ---- Hourly strip ---- */
  // We have past_days=1 data — gives yesterday + today + forecast.
  // "actual" = hours that have already passed (including past hours today and all of yesterday)
  // "forecast" = hours from now onward
  // We show: past 12 hours up to now, then now, then next 12 hours
  const hs=document.getElementById('hscroll');
  hs.innerHTML='';
  const nowH=new Date().getHours();
  const nowDate=new Date();

  // Build a list of hour entries we care about: -12h to +12h from now
  const allHours=[];
  hourly.time.forEach((t,i)=>{
    const dt=new Date(t);
    const diffH=Math.round((dt-nowDate)/3600000);
    if(diffH>=-25&&diffH<=12){
      allHours.push({iso:t,idx:i,diffH,hour:dt.getHours(),dt});
    }
  });

  let nowCardEl=null;
  allHours.forEach(({iso,idx,diffH,hour,dt})=>{
    const isNow=diffH===0;
    const isPast=diffH<0;
    const isFuture=diffH>0;
    const temp=hourly.temperature_2m[idx];
    const pop=hourly.precipitation_probability?.[idx]??0;

    // For past hours: sanity-check the weathercode against actual recorded precipitation.
    // If the model says "clear" but there's real precipitation recorded, override with rain/snow.
    let weatherCode=hourly.weathercode?.[idx]??0;
    if(isPast||isNow){
      const actualPrecip=hourly.precipitation?.[idx]||0;
      const tempC=hourly.temperature_2m?.[idx]??10;
      // Clear/mainly clear but precipitation was actually recorded → fix the icon
      if(actualPrecip>=1&&weatherCode<=1){
        weatherCode=tempC<=0?71:61; // snow or rain
      } else if(actualPrecip>=0.2&&weatherCode<=1){
        weatherCode=tempC<=0?77:51; // snow grains or drizzle
      }
    }
    const[ic]=wmoForHour(weatherCode, dt.getTime(), daily);

    const card=document.createElement('div');
    card.className='hr-card '+(isNow?'now':isPast?'past':'future');

    // For past hours we show "actual" tag; for future "forecast"
    // We also show a mini comparison for past: actual temp vs what was "forecast" at that model step
    // Since we only have one data stream (the model analysis), we approximate:
    //   actual = temperature_2m (model analysis / observed)
    //   We show precipitation probability as the "forecast signal"

    let inner='';
    if(isNow) inner+=`<div class="now-pip">Now</div>`;

    // Date label for hours that cross midnight
    const dayLabel=dt.toLocaleDateString('en-US',{weekday:'short'});
    const todLabel=localISO(dt)===tod?'':dayLabel+' ';
    inner+=`<div class="hr-time">${todLabel}${fmt12(hour)}</div>`;
    inner+=`<div class="hr-icon">${ic}</div>`;
    inner+=`<div class="hr-temp">${fn(temp)}<span style="font-size:12px;color:var(--muted)">°</span></div>`;

    if(isNow){
      inner+=`<div class="hr-tag now-tag">Now</div>`;
    } else if(isPast){
      inner+=`<div class="hr-tag actual">Actual</div>`;
    } else {
      inner+=`<div class="hr-tag forecast">Forecast</div>`;
    }

    if(pop>0) inner+=`<div class="hr-pop">💧${Math.round(pop)}%</div>`;

    card.innerHTML=inner;
    if(isNow)nowCardEl=card;
    hs.appendChild(card);
  });

  // Scroll so "now" card is left-visible with 1 card of past showing
  if(nowCardEl){
    setTimeout(()=>{
      hs.scrollLeft=nowCardEl.offsetLeft-(hs.offsetWidth/2)+(nowCardEl.offsetWidth/2);
    },120);
  }

  /* ---- Past 7 daily ---- */
  const ps=document.getElementById('pscroll');
  ps.innerHTML='';
  daily.time.forEach((iso,i)=>{
    if(iso>=tod)return;
    const isY=iso===yest;
    const mx=daily.temperature_2m_max[i],mn=daily.temperature_2m_min[i],av=(mx+mn)/2;
    const[ic]=wmo(daily.weathercode[i]);
    const pr=daily.precipitation_sum[i]||0;
    const c=document.createElement('div');
    c.className='past-card'+(isY?' hl':'');
    c.innerHTML=(isY?'<div class="yb">Yesterday</div>':'')+
      `<div class="past-day">${dayS(iso)} ${monD(iso)}</div>`+
      `<div class="past-icon">${ic}</div>`+
      `<div class="past-avg">${fn(av)}°</div>`+
      `<div class="past-range">${fn(mn)}° – ${fn(mx)}°</div>`+
      (pr>0?`<div class="past-pr">💧 ${pr.toFixed(1)} mm</div>`:'');
    ps.appendChild(c);
  });
  setTimeout(()=>{ps.scrollLeft=ps.scrollWidth;},120);

  /* ---- Forecast ---- */
  const fl=document.getElementById('fclist');
  fl.innerHTML='';
  daily.time.forEach((iso,i)=>{
    if(iso<tod)return;
    const isT=iso===tod;
    const mx=daily.temperature_2m_max[i],mn=daily.temperature_2m_min[i];
    const[ic,ds]=wmo(daily.weathercode[i]);
    const pop=daily.precipitation_probability_max?.[i];
    const r=document.createElement('div');
    r.className='fc-row'+(isT?' tod':'');
    r.innerHTML=`<div class="fc-dc"><div class="fc-dn${isT?' t':''}">${isT?'Today':dayS(iso)}</div><div class="fc-dt">${monD(iso)}</div></div>`+
      `<div class="fc-ic">${ic}</div><div class="fc-ds">${ds}</div>`+
      `<div class="fc-pop">${pop!=null?'💧'+Math.round(pop)+'%':''}</div>`+
      `<div class="fc-tc"><div class="fc-hi">${fn(mx)}°</div><div class="fc-lo">${fn(mn)}°</div></div>`;
    fl.appendChild(r);
  });
}

async function fetchWeather(lat,lon){
  setStatus('Fetching weather…');
  const df='temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max,precipitation_probability_max,sunrise,sunset';
  const hf='temperature_2m,precipitation_probability,weathercode,precipitation';
  // Use 3 days back to catch the full -12h window in any timezone
  const ago3=offsetISO(-3), tom1=offsetISO(1);

  const [mainRes, histFcRes] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${df}&hourly=${hf}&past_days=7&forecast_days=7&timezone=auto`),
    fetch(`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,weathercode&start_date=${ago3}&end_date=${tom1}&models=gfs_seamless&timezone=auto`)
      .catch(e=>{console.warn('Historical forecast API failed:',e);return null;})
  ]);

  if(!mainRes.ok) throw new Error(`HTTP ${mainRes.status}`);
  const data = await mainRes.json();
  if(!data.daily||!data.hourly) throw new Error('Bad response');

  let histFc=null;
  if(histFcRes&&histFcRes.ok){
    try{
      const hd=await histFcRes.json();
      if(hd.hourly&&hd.hourly.time&&hd.hourly.temperature_2m){
        histFc=hd.hourly;
        console.log('Historical GFS loaded:',histFc.time.length,'hours, weathercode:',!!histFc.weathercode);
      }
    }catch(e){console.warn('Historical forecast parse failed:',e);}
  }

  return{daily:data.daily, hourly:data.hourly, histFc, lat, lon};
}

async function loadCity(lat,lon,name,cc){
  showLoad();
  document.getElementById('ln').textContent=name||'Your Location';
  document.getElementById('lcc').textContent=cc||'';
  try{
    const data=await fetchWeather(lat,lon);
    renderAll(data);
    const now=new Date();
    const ts=now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const el=document.getElementById('updated-ts');
    if(el)el.textContent=`Updated ${ts}`;
    showMain();
  }catch(e){
    console.error(e);
    showErr(e.message);
  }
}

async function revGeo(lat,lon){
  try{
    setStatus('Finding your location…');
    const r=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const d=await r.json();
    const city=d.address.city||d.address.town||d.address.village||d.address.municipality||'Your Location';
    const cc=(d.address.country_code||'').toUpperCase();
    return{city,cc};
  }catch{return{city:'Your Location',cc:''};}
}

// Info modal
document.getElementById('info-btn').addEventListener('click',()=>{
  document.getElementById('info-backdrop').classList.add('open');
  document.getElementById('info-sheet').classList.add('open');
});
function closeInfo(){
  document.getElementById('info-backdrop').classList.remove('open');
  document.getElementById('info-sheet').classList.remove('open');
}

// Search
let st=null;
const si_el=document.getElementById('si'),sr_el=document.getElementById('sr');
si_el.addEventListener('input',()=>{clearTimeout(st);const q=si_el.value.trim();if(q.length<2){sr_el.style.display='none';return;}st=setTimeout(()=>doSearch(q),380);});
async function doSearch(q){
  try{
    const res=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
    const d=await res.json();
    if(!d.results?.length){sr_el.style.display='none';return;}
    sr_el.innerHTML='';
    d.results.forEach(p=>{
      const a=p.admin1?`, ${p.admin1}`:'';
      const item=document.createElement('div');
      item.className='sri';
      item.innerHTML=`<span class="sri-pin">◎</span><span>${p.name}${a}, ${p.country_code||''}</span>`;
      item.addEventListener('click',()=>{si_el.value='';sr_el.style.display='none';track('city_search',{city:p.name,country:p.country_code||''});loadCity(p.latitude,p.longitude,p.name,p.country_code||'');});
      sr_el.appendChild(item);
    });
    sr_el.style.display='block';
  }catch(e){console.error('Search error',e);}
}
document.getElementById('sb').addEventListener('click',()=>{if(si_el.value.trim())doSearch(si_el.value.trim());});
si_el.addEventListener('keydown',e=>{if(e.key==='Enter'&&si_el.value.trim())doSearch(si_el.value.trim());});
document.addEventListener('click',e=>{if(!document.getElementById('swrap').contains(e.target))sr_el.style.display='none';});

document.getElementById('gpsbtn').addEventListener('click',()=>{
  if(!navigator.geolocation)return;
  track('gps_used');
  showLoad();
  setStatus('Getting GPS…');
  navigator.geolocation.getCurrentPosition(
    async p=>{const{latitude:lat,longitude:lon}=p.coords;const{city,cc}=await revGeo(lat,lon);loadCity(lat,lon,city,cc);},
    ()=>loadCity(37.7749,-122.4194,'San Francisco','US'),
    {timeout:10000,maximumAge:60000}
  );
});

function showLoad(){document.getElementById('loader').classList.remove('gone');document.getElementById('main').style.display='none';document.getElementById('ea').innerHTML='';}
function showMain(){document.getElementById('loader').classList.add('gone');document.getElementById('main').style.display='block';}
function showErr(msg){
  document.getElementById('loader').classList.add('gone');
  document.getElementById('ea').innerHTML=`<div class="err-wrap"><div class="err-i">⛅</div><div class="err-t">Couldn't load</div><div class="err-m">${msg||'Check your connection and try again.'}</div><button class="err-btn" onclick="init()">Retry</button></div>`;
}

async function init(){
  track('pageview');
  updateToggleUI();
  showLoad();
  setStatus('Starting up…');
  if(!navigator.geolocation){loadCity(37.7749,-122.4194,'San Francisco','US');return;}
  setStatus('Getting GPS position…');
  navigator.geolocation.getCurrentPosition(
    async p=>{const{latitude:lat,longitude:lon}=p.coords;const{city,cc}=await revGeo(lat,lon);loadCity(lat,lon,city,cc);},
    ()=>{setStatus('No GPS — using San Francisco');loadCity(37.7749,-122.4194,'San Francisco','US');},
    {timeout:10000,maximumAge:60000}
  );
}
init();

// ---- FOG MONSTER ----
function isBayArea(lat,lon){
  // Main Bay Area bounding box
  const inBox=lat>=37.1&&lat<=38.3&&lon>=-123.0&&lon<=-121.5;
  // Monterey (~36.60) and Carmel-by-the-Sea (~36.55) added by hand
  const isMontereyCarmel=lat>=36.5&&lat<=36.7&&lon>=-121.95&&lon<=-121.8;
  return inBox||isMontereyCarmel;
}

function calcForecastMaxError(hourly,histFc){
  if(!histFc||!histFc.temperature_2m) return null;
  const nowMs=Date.now();
  const startMs=nowMs-12*3600000;
  const fcMap={};
  histFc.time.forEach((t,i)=>{fcMap[t.substring(0,16)]=histFc.temperature_2m[i];});
  let maxError=null;
  hourly.time.forEach((t,i)=>{
    const ms=new Date(t).getTime();
    if(ms<startMs||ms>nowMs) return;
    const fcTemp=fcMap[t.substring(0,16)];
    const actual=hourly.temperature_2m[i];
    if(fcTemp!=null&&actual!=null){
      const err=Math.abs(actual-fcTemp);
      if(maxError===null||err>maxError) maxError=err;
    }
  });
  return maxError;
}

function spawnFogMonster(isFoggy,errorC){
  const existing=document.getElementById('fog-monster');
  if(existing) existing.remove();
  track('fog_monster',{trigger:errorC!=null?'error':'fog',errorF:errorC!=null?Math.round(errorC*9/5):null});

  let errLabel=null;
  if(errorC!=null){
    errLabel=FAH?`Argh! Forecast was ${Math.round(errorC*9/5)}°F off!`:`Argh! Forecast was ${errorC.toFixed(1)}°C off!`;
  } else if(isFoggy){
    errLabel='Rolling in!';
  }
  const showBadge=errLabel!=null;

  const el=document.createElement('div');
  el.className='fog-monster';
  el.id='fog-monster';
  el.innerHTML=`
    <div class="fog-monster-inner" onclick="dismissFog()">
      ${showBadge?`<div class="fog-error-badge">${errLabel}</div>`:''}
      <img src="fog-monster.png" width="260" style="display:block;filter:drop-shadow(0 0 18px rgba(200,230,255,0.25));" alt="fog monster"/>
      <div class="fog-tap-hint">tap to shoo away</div>
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(()=>{ const m=document.getElementById('fog-monster'); if(m) m.remove(); }, 20000);
}

function dismissFog(){
  const el=document.getElementById('fog-monster');
  if(el){ el.classList.add('dismissing'); setTimeout(()=>el.remove(),700); }
}

// Hook into renderAll to check for fog monster is done inside renderAll directly
