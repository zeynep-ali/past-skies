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
  const dateStr=new Date(dtMs).toISOString().slice(0,10);
  const dayIdx=daily.time.indexOf(dateStr);
  if(dayIdx===-1) return wmo(code);
  const sunrise=daily.sunrise?.[dayIdx];
  const sunset=daily.sunset?.[dayIdx];
  if(!sunrise||!sunset) return wmo(code);
  const sunriseMs=localMs(sunrise);
  const sunsetMs=localMs(sunset);
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
function localMs(iso){return new Date(iso+'Z').getTime();}
function cityNowMs(off){return Date.now()+(off||0)*1000;}
function cityDateStr(off,n){const d=new Date(Date.now()+(off||0)*1000+(n||0)*86400000);return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');}
function dayS(iso){return new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'});}
function monD(iso){return new Date(iso+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function fmt12(h){return(h%12||12)+(h>=12?' pm':' am');}
function setStatus(t){const e=document.getElementById('updated-ts');if(e)e.textContent=t;}

function renderAll(data){
  rawData=data;
  renderMain(data);
  renderChart(data);
  renderPrecipChart(data);
  // Fog monster — shows if fog in today's forecast OR any historical point was >4°F off
  if(data.lat&&data.lon&&isBayArea(data.lat,data.lon)){
    const off=data.utcOffsetSec??0;
    const nowMs=cityNowMs(off);
    const todayEnd=localMs(cityDateStr(off,1)+'T00:00')-1;
    let isFoggy=false;
    data.hourly.time.forEach((t,i)=>{
      const ms=localMs(t);
      if(ms>=nowMs&&ms<=todayEnd){
        const wc=data.hourly.weathercode?.[i]??0;
        if(wc===45||wc===48) isFoggy=true;
      }
    });
    // Also trigger if today's or tomorrow's daily icon is fog
    const todayStr=cityDateStr(off,0);
    const tomorrowStr=cityDateStr(off,1);
    data.daily.time.forEach((t,i)=>{
      if(t===todayStr||t===tomorrowStr){
        const wc=data.daily.weathercode?.[i]??0;
        if(wc===45||wc===48) isFoggy=true;
      }
    });
    const maxErrorC=calcForecastMaxError(data.hourly,data.histFc,off);
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

  const nowMs=cityNowMs(data.utcOffsetSec??0);
  const startMs=nowMs-12*3600000;
  const endMs=nowMs+12*3600000;

  const actualPts=[];
  hourly.time.forEach((t,i)=>{
    const ms=localMs(t);
    if(ms>=startMs&&ms<=endMs){
      actualPts.push({ms,val:hourly.precipitation?.[i]||0});
    }
  });

  const gfsPastPts=[];
  if(histFc&&histFc.precipitation){
    histFc.time.forEach((t,i)=>{
      const ms=localMs(t);
      if(ms>=startMs&&ms<=nowMs){
        gfsPastPts.push({ms,val:histFc.precipitation[i]||0});
      }
    });
  }
  const gfsFuturePts=[];
  hourly.time.forEach((t,i)=>{
    const ms=localMs(t);
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
    label:h===0?'now':fmt12(new Date(nowMs+h*3600000).getUTCHours()),
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
  note.textContent=hasPastGFS?'Pink = what GFS predicted · Teal = recorded rain':'GFS past forecast not available';
}

function renderChart(data){
  const{hourly,histFc}=data;
  const body=document.getElementById('chart-body');
  const note=document.getElementById('chart-note');
  if(!body)return;

  const nowMs=cityNowMs(data.utcOffsetSec??0);
  const startMs=nowMs-12*3600000;
  const endMs=nowMs+12*3600000;

  const actualPts=[];
  hourly.time.forEach((t,i)=>{
    const ms=localMs(t);
    if(ms>=startMs&&ms<=nowMs){
      const temp=hourly.temperature_2m[i];
      if(temp!=null) actualPts.push({ms,temp});
    }
  });

  const gfsPastPts=[];
  if(histFc){
    histFc.time.forEach((t,i)=>{
      const ms=localMs(t);
      if(ms>=startMs&&ms<=nowMs){
        const temp=histFc.temperature_2m[i];
        if(temp!=null) gfsPastPts.push({ms,temp});
      }
    });
    console.log('GFS past points in window:',gfsPastPts.length);
  }

  const gfsFuturePts=[];
  hourly.time.forEach((t,i)=>{
    const ms=localMs(t);
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
    label:h===0?'now':fmt12(new Date(nowMs+h*3600000).getUTCHours()),
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
  const off=data.utcOffsetSec??0;
  const tod=cityDateStr(off,0),yest=cityDateStr(off,-1);

  /* ---- Yesterday hero ---- */
  const yi=daily.time.indexOf(yest);
  const si=yi>=0?yi:Math.max(0,daily.time.findIndex(t=>t>=tod)-1);
  const yMax=daily.temperature_2m_max[si],yMin=daily.temperature_2m_min[si],yAvg=(yMax+yMin)/2;
  const[yIc,yDs]=wmo(daily.weathercode[si]);
  const yPr=daily.precipitation_sum[si]||0,yWi=daily.windspeed_10m_max[si]||0;
  // Yesterday feels like: average apparent temp for that day
  const yFeelsVals=[];
  hourly.time.forEach((t,i)=>{if(t.slice(0,10)===yest){const at=hourly.apparent_temperature?.[i];if(at!=null)yFeelsVals.push(at);}});
  const yFeels=yFeelsVals.length?yFeelsVals.reduce((a,b)=>a+b,0)/yFeelsVals.length:null;
  document.getElementById('yt').textContent=fn(yAvg);
  document.getElementById('yu').textContent=FAH?'°F':'°C';
  document.getElementById('yi').textContent=yIc;
  document.getElementById('yd').textContent=yDs;
  document.getElementById('y-feels').textContent=yFeels!=null?`Felt ${ft(yFeels)}`:'';
  document.getElementById('y-range').textContent=`${ft(yMax)} / ${ft(yMin)}`;
  document.getElementById('y-precip').textContent=`${yPr.toFixed(1)} mm`;
  document.getElementById('y-wind').textContent=`${Math.round(yWi)} km/h`;

  /* ---- Today forecast hero ---- */
  const ti=daily.time.indexOf(tod);
  if(ti>=0){
    const tMax=daily.temperature_2m_max[ti],tMin=daily.temperature_2m_min[ti],tAvg=(tMax+tMin)/2;
    const[tIc,tDs]=wmo(daily.weathercode[ti]);
    const tPr=daily.precipitation_sum[ti]||0,tWi=daily.windspeed_10m_max[ti]||0;
    // Today feels like: most recent past hour's apparent temp, or next hour if early morning
    const nowMs=cityNowMs(off);
    let tdFeels=null;
    hourly.time.forEach((t,i)=>{
      if(t.slice(0,10)===tod){const at=hourly.apparent_temperature?.[i];if(at!=null&&localMs(t)<=nowMs)tdFeels=at;}
    });
    if(tdFeels===null){const next=hourly.time.findIndex(t=>t.slice(0,10)===tod);if(next>=0){const at=hourly.apparent_temperature?.[next];if(at!=null)tdFeels=at;}}
    document.getElementById('td-temp').textContent=fn(tAvg);
    document.getElementById('td-unit').textContent=FAH?'°F':'°C';
    document.getElementById('td-icon').textContent=tIc;
    document.getElementById('td-cond').textContent=tDs;
    document.getElementById('td-feels').textContent=tdFeels!=null?`Feels ${ft(tdFeels)}`:'';
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
  const nowMs=cityNowMs(off);

  // Build a list of hour entries we care about: -12h to +12h from now
  const allHours=[];
  hourly.time.forEach((t,i)=>{
    const dtMs=localMs(t);
    const diffH=Math.round((dtMs-nowMs)/3600000);
    if(diffH>=-25&&diffH<=12){
      allHours.push({iso:t,idx:i,diffH,hour:new Date(dtMs).getUTCHours(),dtMs});
    }
  });

  let nowCardEl=null;
  allHours.forEach(({iso,idx,diffH,hour,dtMs})=>{
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
    const[ic]=wmoForHour(weatherCode, dtMs, daily);

    const card=document.createElement('div');
    card.className='hr-card '+(isNow?'now':isPast?'past':'future');

    let inner='';
    if(isNow) inner+=`<div class="now-pip">Now</div>`;

    // Date label for hours that cross midnight
    const dayLabel=dayS(iso.slice(0,10));
    const todLabel=iso.slice(0,10)===tod?'':dayLabel+' ';
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
    c.addEventListener('click',()=>openDaySheet(iso));
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

// ---- DEV MODE — set to true to use fake data instead of live API ----
const DEV_MODE = false;

function makeFakeData(){
  const now=new Date();
  const daily={time:[],temperature_2m_max:[],temperature_2m_min:[],precipitation_sum:[],weathercode:[],windspeed_10m_max:[],precipitation_probability_max:[],sunrise:[],sunset:[]};
  for(let i=-7;i<=7;i++){
    const d=new Date(now); d.setDate(d.getDate()+i);
    const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    daily.time.push(iso);
    daily.temperature_2m_max.push(18+Math.sin(i)*3);
    daily.temperature_2m_min.push(10+Math.sin(i)*2);
    daily.precipitation_sum.push(i%3===0?2.4:0);
    daily.weathercode.push(i%3===0?61:i%5===0?2:0);
    daily.windspeed_10m_max.push(15+i);
    daily.precipitation_probability_max.push(i%3===0?70:10);
    daily.sunrise.push(iso+'T06:20');
    daily.sunset.push(iso+'T19:45');
  }
  const hourly={time:[],temperature_2m:[],precipitation_probability:[],weathercode:[],precipitation:[]};
  const startH=new Date(now); startH.setHours(startH.getHours()-30,0,0,0);
  for(let i=0;i<55;i++){
    const h=new Date(startH); h.setHours(h.getHours()+i);
    const iso=h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0')+'-'+String(h.getDate()).padStart(2,'0')+'T'+String(h.getHours()).padStart(2,'0')+':00';
    hourly.time.push(iso);
    hourly.temperature_2m.push(14+Math.sin(i/4)*5);
    hourly.precipitation_probability.push(i%8===0?60:5);
    hourly.weathercode.push(i%8===0?61:h.getHours()<6||h.getHours()>20?1:0);
    hourly.precipitation.push(i%8===0?0.8:0);
  }
  return{daily,hourly,histFc:null,lat:37.7749,lon:-122.4194};
}

function wxCacheKey(lat,lon){return`wx_${lat.toFixed(2)}_${lon.toFixed(2)}`;}
function saveWxCache(key,data){try{localStorage.setItem(key,JSON.stringify({...data,_ts:Date.now()}));}catch(e){}}
function loadWxCache(key){try{const s=localStorage.getItem(key);return s?JSON.parse(s):null;}catch{return null;}}

async function fetchWeather(lat,lon){
  if(DEV_MODE){setStatus('Dev mode — using fake data');return makeFakeData();}
  setStatus('Fetching weather…');
  const df='temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max,precipitation_probability_max,sunrise,sunset';
  const hf='temperature_2m,apparent_temperature,precipitation_probability,weathercode,precipitation';
  const ago7=offsetISO(-7), tom1=offsetISO(1);

  const ctrl=new AbortController();
  const tid=setTimeout(()=>ctrl.abort(),10000);

  let mainRes, histFcRes;
  try{
    [mainRes, histFcRes] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${df}&hourly=${hf}&past_days=7&forecast_days=7&timezone=auto`,{signal:ctrl.signal}),
      fetch(`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,weathercode&start_date=${ago7}&end_date=${tom1}&models=gfs_seamless&timezone=auto`,{signal:ctrl.signal})
        .catch(e=>{console.warn('Historical forecast API failed:',e);return null;})
    ]);
  }finally{clearTimeout(tid);}

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

  const result={daily:data.daily, hourly:data.hourly, histFc, lat, lon, utcOffsetSec:data.utc_offset_seconds||0};
  saveWxCache(wxCacheKey(lat,lon),result);
  return result;
}

async function loadCity(lat,lon,name,cc){
  document.getElementById('ln').textContent=name||'Your Location';
  document.getElementById('lcc').textContent=cc||'';
  const el=document.getElementById('updated-ts');
  if(el)el.textContent='Loading…';
  try{
    const data=await fetchWeather(lat,lon);
    renderAll(data);
    saveTomorrowForecast(lat,lon,data);
    const now=new Date();
    const ts=now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    if(el)el.textContent=`Updated ${ts}`;
  }catch(e){
    console.error(e);
    const cached=loadWxCache(wxCacheKey(lat,lon));
    if(cached){
      renderAll(cached);
      const hrs=Math.round((Date.now()-cached._ts)/3600000);
      const age=hrs<1?'less than an hour':hrs===1?'1 hour':`${hrs} hours`;
      if(el)el.textContent=`Cached data from ${age} ago — API unavailable`;
    }else{
      const isNetworkErr=e instanceof TypeError&&e.message.toLowerCase().includes('fetch')||e.name==='AbortError';
      showErr(isNetworkErr?'Weather data is currently unavailable. Open-Meteo may be down — please try again in a few minutes.':e.message);
    }
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
      item.addEventListener('click',()=>{si_el.value='';sr_el.style.display='none';track('city_search',{city:p.name,country:p.country_code||'',lat:p.latitude,lon:p.longitude});loadCity(p.latitude,p.longitude,p.name,p.country_code||'');});
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
  navigator.geolocation.getCurrentPosition(
    async p=>{const{latitude:lat,longitude:lon}=p.coords;const{city,cc}=await revGeo(lat,lon);loadCity(lat,lon,city,cc);},
    ()=>loadCity(37.7749,-122.4194,'San Francisco','US'),
    {timeout:10000,maximumAge:60000}
  );
});

function saveTomorrowForecast(lat,lon,data){
  const tomorrow=offsetISO(1);
  const key=`ps_fc_${lat.toFixed(2)}_${lon.toFixed(2)}_${tomorrow}`;
  if(localStorage.getItem(key))return;
  const temp={};const precip={};
  data.hourly.time.forEach((t,i)=>{
    if(!t.startsWith(tomorrow))return;
    const hr=parseInt(t.slice(11,13));
    if(data.hourly.temperature_2m[i]!=null)temp[hr]=data.hourly.temperature_2m[i];
    if(data.hourly.precipitation?.[i]!=null)precip[hr]=data.hourly.precipitation[i];
  });
  if(Object.keys(temp).length<12)return;
  try{localStorage.setItem(key,JSON.stringify({temp,precip}));}catch(e){}
}
let currentDayISO=null;

function svgToImg(svgEl){
  const vb=svgEl.getAttribute('viewBox').split(' ').map(Number);
  const[,,vw,vh]=vb;
  svgEl.setAttribute('width',vw);svgEl.setAttribute('height',vh);
  const xml=new XMLSerializer().serializeToString(svgEl);
  svgEl.removeAttribute('width');svgEl.removeAttribute('height');
  const dataUrl='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(xml)));
  return new Promise((res,rej)=>{
    const img=new Image();
    img.onload=()=>res({img,w:vw,h:vh});
    img.onerror=rej;
    img.src=dataUrl;
  });
}

function shareTextFallback(iso,city,ic,ds,mx,mn){
  const pr=rawData.daily.precipitation_sum[rawData.daily.time.indexOf(iso)]||0;
  const dateStr=dayS(iso)+' '+monD(iso);
  let text=`${city} · ${dateStr}\n${ic} ${ds}, ${ft((mx+mn)/2)}`;
  if(pr>0)text+=` · 💧 ${pr.toFixed(1)} mm`;
  text+=`\n\nPast Skies — what the weather was\nhttps://app.past-skies.com`;
  const btn=document.getElementById('day-share-btn');
  if(navigator.share){
    navigator.share({title:`Past Skies — ${city} ${dateStr}`,text,url:'https://app.past-skies.com'}).catch(()=>{});
  }else{
    navigator.clipboard.writeText(text).then(()=>{
      if(btn){const orig=btn.textContent;btn.textContent='Copied!';setTimeout(()=>btn.textContent=orig,2000);}
    }).catch(()=>{});
  }
}

async function buildAndShareCard(city, dateStr, ic, ds, mx, mn, tempSvgEl, precipSvgEl, btn, filename){
  if(btn){btn.textContent='…';btn.disabled=true;}
  try{
    const S=2,PX=20,CW=400,CARD_W=CW+PX*2;
    const tempR=await svgToImg(tempSvgEl);
    const precipR=precipSvgEl?await svgToImg(precipSvgEl):null;

    const CARD_H=[18,22,18,8,28,14,tempR.h,...(precipR?[8,precipR.h]:[]),14,16,12].reduce((s,h)=>s+h,0);
    const canvas=document.createElement('canvas');
    canvas.width=CARD_W*S;canvas.height=CARD_H*S;
    const ctx=canvas.getContext('2d');
    ctx.scale(S,S);

    ctx.fillStyle='#080d18';
    ctx.fillRect(0,0,CARD_W,CARD_H);

    let y=0;
    const adv=h=>{y+=h;};

    adv(18);
    ctx.font='bold 17px -apple-system,BlinkMacSystemFont,sans-serif';
    ctx.fillStyle='rgba(255,255,255,0.9)';ctx.textAlign='left';
    ctx.fillText(city,PX,y+16);adv(22);

    ctx.font='12px -apple-system,BlinkMacSystemFont,sans-serif';
    ctx.fillStyle='rgba(255,255,255,0.38)';
    ctx.fillText(dateStr,PX,y+13);adv(18);

    adv(8);
    ctx.font='20px "Apple Color Emoji","Segoe UI Emoji",serif';
    ctx.fillText(ic,PX,y+22);
    ctx.font='11px -apple-system,BlinkMacSystemFont,sans-serif';
    ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText(ds,PX+28,y+12);
    ctx.fillStyle='rgba(255,255,255,0.75)';ctx.font='bold 11px -apple-system,BlinkMacSystemFont,sans-serif';
    ctx.fillText(`${ft(mx)} / ${ft(mn)}`,PX+28,y+26);adv(28);

    adv(14);
    ctx.drawImage(tempR.img,PX,y,CW,tempR.h);adv(tempR.h);
    if(precipR){adv(8);ctx.drawImage(precipR.img,PX,y,CW,precipR.h);adv(precipR.h);}

    adv(14);
    ctx.fillStyle='rgba(255,255,255,0.18)';
    ctx.font='10px -apple-system,BlinkMacSystemFont,sans-serif';
    ctx.textAlign='center';
    ctx.fillText('past-skies.com · what the weather was',CARD_W/2,y+12);

    canvas.toBlob(async blob=>{
      if(btn){btn.textContent='Share ↗';btn.disabled=false;}
      const file=new File([blob],filename,{type:'image/png'});
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        navigator.share({files:[file],title:`Past Skies — ${city} ${dateStr}`}).catch(()=>{});
      }else{
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=filename;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href),10000);
      }
    },'image/png');
    return true;
  }catch(e){
    console.error('Share image failed',e);
    if(btn){btn.textContent='Share ↗';btn.disabled=false;}
    return false;
  }
}

async function shareDaySheet(){
  if(!rawData||!currentDayISO)return;
  const iso=currentDayISO;
  const city=document.getElementById('ln').textContent||'';
  const{daily}=rawData;
  const di=daily.time.indexOf(iso);
  if(di===-1)return;
  const[ic,ds]=wmo(daily.weathercode[di]);
  const mx=daily.temperature_2m_max[di],mn=daily.temperature_2m_min[di];
  const tempSvg=document.querySelector('#day-chart-body svg');
  if(!tempSvg){shareTextFallback(iso,city,ic,ds,mx,mn);return;}
  const precipOuter=document.getElementById('day-precip-outer');
  const precipSvg=precipOuter&&precipOuter.style.display!=='none'?document.querySelector('#day-precip-body svg'):null;
  const btn=document.getElementById('day-share-btn');
  const ok=await buildAndShareCard(city,dayS(iso)+' · '+monD(iso),ic,ds,mx,mn,tempSvg,precipSvg,btn,`past-skies-${iso}.png`);
  if(!ok)shareTextFallback(iso,city,ic,ds,mx,mn);
}

async function shareMainChart(){
  if(!rawData)return;
  const city=document.getElementById('ln').textContent||'';
  const off=rawData.utcOffsetSec??0;
  const tod=cityDateStr(off,0);
  const{daily}=rawData;
  const di=daily.time.indexOf(tod);
  if(di===-1)return;
  const[ic,ds]=wmo(daily.weathercode[di]);
  const mx=daily.temperature_2m_max[di],mn=daily.temperature_2m_min[di];
  const tempSvg=document.querySelector('#chart-body svg');
  if(!tempSvg)return;
  const precipOuter=document.getElementById('precip-outer');
  const precipSvg=precipOuter&&precipOuter.style.display!=='none'?document.querySelector('#precip-body svg'):null;
  const btn=document.getElementById('main-share-btn');
  await buildAndShareCard(city,'Today · '+monD(tod),ic,ds,mx,mn,tempSvg,precipSvg,btn,`past-skies-today-${tod}.png`);
}
function openDaySheet(iso){
  if(!rawData)return;
  currentDayISO=iso;
  const{daily}=rawData;
  const di=daily.time.indexOf(iso);
  if(di===-1)return;
  const[ic,ds]=wmo(daily.weathercode[di]);
  const mx=daily.temperature_2m_max[di],mn=daily.temperature_2m_min[di];
  document.getElementById('day-sheet-title').textContent=dayS(iso)+' · '+monD(iso);
  document.getElementById('day-sheet-meta').innerHTML=`<span style="font-size:20px">${ic}</span><span>${ds}</span><span style="margin-left:auto;font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--text)">${fn((mx+mn)/2)}°</span><span style="font-size:11px">${ft(mx)} / ${ft(mn)}</span>`;
  renderDayChart(iso);
  document.getElementById('day-backdrop').classList.add('open');
  document.getElementById('day-sheet').classList.add('open');
}
function closeDaySheet(){
  document.getElementById('day-backdrop').classList.remove('open');
  document.getElementById('day-sheet').classList.remove('open');
}
async function renderDayChart(iso){
  const body=document.getElementById('day-chart-body');
  const note=document.getElementById('day-chart-note');
  if(!body||!rawData)return;
  body.innerHTML='<div class="chart-loading">Loading…</div>';
  note.textContent='';
  const{hourly}=rawData;
  const actualPts=[];
  hourly.time.forEach((t,i)=>{
    if(!t.startsWith(iso))return;
    const temp=hourly.temperature_2m[i];
    if(temp!=null)actualPts.push({ms:localMs(t),temp,hr:parseInt(t.slice(11,13))});
  });
  const latR=rawData.lat.toFixed(2);
  const lonR=rawData.lon.toFixed(2);
  // Check localStorage first (instant), then fall back to server
  let fcJSON=localStorage.getItem(`ps_fc_${latR}_${lonR}_${iso}`);
  if(!fcJSON){
    try{
      const res=await fetch(`https://analytics.past-skies.com/forecast?date=${iso}&lat=${latR}&lon=${lonR}`);
      if(res.ok) fcJSON=await res.text();
    }catch(e){}
  }
  const gfsPts=[];
  let fcPrecip=null;
  if(fcJSON){
    try{
      const startMs=localMs(iso+'T00:00');
      const parsed=JSON.parse(fcJSON);
      const tempMap=parsed.temp||parsed; // handle old flat format
      fcPrecip=parsed.precip||null;
      Object.entries(tempMap).forEach(([hr,temp])=>{
        const h=parseInt(hr);
        gfsPts.push({ms:startMs+h*3600000,temp:+temp,hr:h});
      });
      gfsPts.sort((a,b)=>a.hr-b.hr);
    }catch(e){}
  }
  if(!actualPts.length){body.innerHTML='<div class="chart-loading">No data for this day</div>';return;}
  const allT=[...actualPts,...gfsPts].map(p=>FAH?c2f(p.temp):p.temp);
  const minT=Math.min(...allT)-1.5,maxT=Math.max(...allT)+1.5;
  const startMs=localMs(iso+'T00:00');
  const endMs=startMs+24*3600000;
  const W=400,H=110,PL=30,PR=8,PT=10,PB=20;
  const cW=W-PL-PR,cH=H-PT-PB;
  const xS=ms=>PL+((ms-startMs)/(endMs-startMs))*cW;
  const yS=t=>PT+(1-((FAH?c2f(t):t)-minT)/(maxT-minT))*cH;
  const mkPath=pts=>pts.length<2?'':pts.map((p,i)=>`${i===0?'M':'L'}${xS(p.ms).toFixed(1)},${yS(p.temp).toFixed(1)}`).join(' ');
  const spread=maxT-minT;const step=spread>12?4:spread>6?2:1;const tickStart=Math.ceil(minT/step)*step;
  const yTicks=[];for(let t=tickStart;t<=maxT;t+=step)yTicks.push(t);
  const xTicks=[0,6,12,18].map(h=>({ms:startMs+h*3600000,label:fmt12(h)}));
  let maxErr=null;
  if(gfsPts.length){
    const fcMap={};gfsPts.forEach(p=>fcMap[p.hr]=p.temp);
    actualPts.forEach(p=>{const fc=fcMap[p.hr];if(fc!=null){const err=Math.abs(p.temp-fc);if(maxErr===null||err>maxErr)maxErr=err;}});
  }
  body.innerHTML=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
    ${yTicks.map(t=>`<line x1="${PL}" y1="${yS(FAH?c2f(t):t).toFixed(1)}" x2="${W-PR}" y2="${yS(FAH?c2f(t):t).toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/><text x="${PL-4}" y="${(yS(FAH?c2f(t):t)+3).toFixed(1)}" fill="rgba(255,255,255,0.22)" font-size="7.5" text-anchor="end">${Math.round(FAH?c2f(t):t)}°</text>`).join('')}
    ${gfsPts.length>1?`<path d="${mkPath(gfsPts)}" stroke="rgba(220,100,160,0.85)" stroke-width="1.5" fill="none" stroke-dasharray="4,3"/>`:''}
    ${actualPts.length>1?`<path d="${mkPath(actualPts)} L${xS(actualPts[actualPts.length-1].ms).toFixed(1)},${H-PB} L${xS(actualPts[0].ms).toFixed(1)},${H-PB}Z" fill="rgba(77,217,192,0.07)"/><path d="${mkPath(actualPts)}" stroke="#4dd9c0" stroke-width="2" fill="none"/>`:''}
    ${xTicks.map(t=>`<text x="${xS(t.ms).toFixed(1)}" y="${H-PB+13}" fill="rgba(255,255,255,0.2)" font-size="7.5" text-anchor="middle">${t.label}</text>`).join('')}
  </svg>`;
  // Precipitation chart
  const precipOuter=document.getElementById('day-precip-outer');
  const precipBody=document.getElementById('day-precip-body');
  const precipNote=document.getElementById('day-precip-note');
  if(precipOuter&&precipBody){
    const actualPrecipPts=[];
    hourly.time.forEach((t,i)=>{
      if(!t.startsWith(iso))return;
      const val=hourly.precipitation?.[i]||0;
      actualPrecipPts.push({hr:parseInt(t.slice(11,13)),val});
    });
    const fcPrecipPts=fcPrecip?Object.entries(fcPrecip).map(([hr,val])=>({hr:parseInt(hr),val:+val})).sort((a,b)=>a.hr-b.hr):[];
    const maxP=Math.max(...actualPrecipPts.map(p=>p.val),...fcPrecipPts.map(p=>p.val),0);
    if(maxP<0.05){
      precipOuter.style.display='none';
    }else{
      precipOuter.style.display='block';
      const PW=400,PH=70,PPL=30,PPR=8,PPT=8,PPB=20;
      const pcW=PW-PPL-PPR,pcH=PH-PPT-PPB;
      const pxS=hr=>PPL+(hr/24)*pcW;
      const pyS=v=>PPT+pcH-(v/maxP)*pcH;
      const bW=Math.max(4,(pcW/24)*0.6);
      let bars='';
      fcPrecipPts.forEach(p=>{
        if(p.val<0.01)return;
        const x=pxS(p.hr+0.5);const barH=(p.val/maxP)*pcH;
        bars+=`<rect x="${(x-bW+1).toFixed(1)}" y="${(PPT+pcH-barH).toFixed(1)}" width="${bW.toFixed(1)}" height="${barH.toFixed(1)}" fill="rgba(220,100,160,0.12)" stroke="rgba(220,100,160,0.7)" stroke-width="1" rx="1"/>`;
      });
      actualPrecipPts.forEach(p=>{
        if(p.val<0.01)return;
        const x=pxS(p.hr+0.5);const barH=(p.val/maxP)*pcH;
        bars+=`<rect x="${(x-bW+1).toFixed(1)}" y="${(PPT+pcH-barH).toFixed(1)}" width="${bW.toFixed(1)}" height="${barH.toFixed(1)}" fill="#7abaef" rx="1"/>`;
      });
      const xLabels=[0,6,12,18].map(h=>`<text x="${pxS(h).toFixed(1)}" y="${PH-PPB+13}" fill="rgba(255,255,255,0.2)" font-size="7.5" text-anchor="middle">${fmt12(h)}</text>`).join('');
      precipBody.innerHTML=`<svg class="chart-svg" viewBox="0 0 ${PW} ${PH}">
        <line x1="${PPL}" y1="${PPT+pcH}" x2="${PW-PPR}" y2="${PPT+pcH}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${PPL-4}" y="${PPT+pcH+3}" fill="rgba(255,255,255,0.2)" font-size="7" text-anchor="end">0</text>
        <text x="${PPL-4}" y="${(PPT+3).toFixed(1)}" fill="rgba(255,255,255,0.2)" font-size="7" text-anchor="end">${maxP.toFixed(1)}</text>
        <text x="${PPL-10}" y="${(PPT+pcH/2).toFixed(1)}" fill="rgba(255,255,255,0.18)" font-size="7" text-anchor="middle" transform="rotate(-90,${PPL-10},${(PPT+pcH/2).toFixed(1)})">mm</text>
        ${bars}${xLabels}
      </svg>`;
      precipNote.textContent=fcPrecipPts.some(p=>p.val>0.01)?'Blue = actual rain · Pink = what GFS predicted':'Actual recorded precipitation';
    }
  }
  const hasGFS=gfsPts.length>1;
  if(hasGFS&&maxErr!==null){const errStr=FAH?`${Math.round(maxErr*9/5)}°F`:`${maxErr.toFixed(1)}°C`;note.textContent=`Teal = actual · Pink = GFS forecast · max ${errStr} off`;}
  else if(hasGFS){note.textContent='Teal = actual · Pink dashed = GFS forecast';}
  else{note.textContent='Forecast snapshot not available';}
}
function showLoad(){}
function showMain(){document.getElementById('loader').classList.add('gone');document.getElementById('main').style.display='block';}
function showErr(msg){
  document.getElementById('loader').classList.add('gone');
  document.getElementById('main').style.display='none';
  document.getElementById('ea').innerHTML=`<div class="err-wrap"><div class="err-i">⛅</div><div class="err-t">Couldn't load</div><div class="err-m">${msg||'Check your connection and try again.'}</div><button class="err-btn" onclick="init()">Retry</button></div>`;
}
function showSkeleton(){
  document.getElementById('loader').classList.add('gone');
  document.getElementById('main').style.display='block';
  document.getElementById('ln').textContent='Locating…';
  document.getElementById('lcc').textContent='';
  const hr=`<div class="hr-card past" style="pointer-events:none;gap:8px"><div class="skel" style="width:38px;height:10px;border-radius:3px"></div><div class="skel" style="width:24px;height:24px;border-radius:4px;margin:4px 0"></div><div class="skel" style="width:34px;height:22px;border-radius:3px"></div><div class="skel" style="width:28px;height:8px;border-radius:3px;margin-top:4px"></div></div>`;
  document.getElementById('hscroll').innerHTML=Array(8).fill(hr).join('');
  const pc=`<div class="past-card" style="pointer-events:none"><div class="skel" style="width:54px;height:9px;border-radius:3px;display:block;margin:0 auto 8px"></div><div class="skel" style="width:28px;height:28px;border-radius:4px;display:block;margin:0 auto 7px"></div><div class="skel" style="width:36px;height:22px;border-radius:3px;display:block;margin:0 auto 3px"></div><div class="skel" style="width:54px;height:9px;border-radius:3px;display:block;margin:0 auto"></div></div>`;
  document.getElementById('pscroll').innerHTML=Array(7).fill(pc).join('');
  const fc=`<div class="fc-row" style="pointer-events:none"><div class="fc-dc"><div class="skel" style="width:32px;height:12px;border-radius:3px;margin-bottom:3px"></div><div class="skel" style="width:22px;height:9px;border-radius:3px"></div></div><div class="skel" style="width:24px;height:24px;border-radius:4px;flex-shrink:0"></div><div class="skel fc-ds" style="height:11px;border-radius:3px"></div><div style="min-width:34px"></div><div class="fc-tc"><div class="skel" style="width:26px;height:18px;border-radius:3px;margin-left:auto;margin-bottom:2px"></div><div class="skel" style="width:18px;height:10px;border-radius:3px;margin-left:auto"></div></div></div>`;
  document.getElementById('fclist').innerHTML=Array(7).fill(fc).join('');
}
async function init(){
  track('pageview');
  updateToggleUI();
  showSkeleton();
  const tl=document.getElementById('tagline');
  if(tl)setTimeout(()=>tl.classList.add('visible'),50);
  if(!navigator.geolocation){loadCity(37.7749,-122.4194,'San Francisco','US');return;}
  navigator.geolocation.getCurrentPosition(
    async p=>{const{latitude:lat,longitude:lon}=p.coords;const{city,cc}=await revGeo(lat,lon);loadCity(lat,lon,city,cc);},
    ()=>loadCity(37.7749,-122.4194,'San Francisco','US'),
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

function calcForecastMaxError(hourly,histFc,utcOffsetSec){
  if(!histFc||!histFc.temperature_2m) return null;
  const nowMs=cityNowMs(utcOffsetSec??0);
  const startMs=nowMs-12*3600000;
  const fcMap={};
  histFc.time.forEach((t,i)=>{fcMap[t.substring(0,16)]=histFc.temperature_2m[i];});
  let maxError=null;
  hourly.time.forEach((t,i)=>{
    const ms=localMs(t);
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
