/* Procedural, engine-independent low-poly concepts. Coordinates: metres, Y up,
 * nose +Z. Each face owns its vertices for intentional flat shading.
 * Shared by the Babylon viewer and the self-contained glTF 2.0 exporter. */

const PI = Math.PI;
const vadd = (a, b) => a.map((v, i) => v + b[i]);
const vmul = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v*b[i], 0);
const unit = a => { const l = Math.hypot(...a); return a.map(v => v/(l || 1)); };
const mean = pts => pts[0].map((_, i) => pts.reduce((s, p) => s+p[i], 0)/pts.length);
const lerp = (a, b, t) => a+(b-a)*t;

class Geo {
  constructor() { this.positions=[]; this.normals=[]; this.indices=[]; }
  face(vertices, outward) {
    let pts = vertices.map(p => [...p]);
    let n = unit(cross(vmul(pts[1],pts[0]),vmul(pts[2],pts[0])));
    if (outward && dot(n,outward)<0) { pts.reverse(); n = n.map(v=>-v); }
    const at = this.positions.length/3;
    for (const p of pts) { this.positions.push(...p); this.normals.push(...n); }
    for (let i=1;i<pts.length-1;i++) this.indices.push(at,at+i,at+i+1);
    return this;
  }
  closedFace(vertices, center) { return this.face(vertices,vmul(mean(vertices),center)); }
}
const group = (name, children=[], translation=[0,0,0], rotation) => ({name,children,translation,...(rotation?{rotation}:{})});
const part = (name, geometry, material, translation=[0,0,0]) => ({name,geometry,material,translation});

function octXY(w,h,b,z) {
  const x=w/2, y=h/2, c=Math.min(b,x*.6,y*.6);
  return [[-x+c,-y,z],[x-c,-y,z],[x,-y+c,z],[x,y-c,z],[x-c,y,z],[-x+c,y,z],[-x,y-c,z],[-x,-y+c,z]];
}
function bevelBox(w,h,l,b=.035) {
  b=Math.min(b,w/5,h/5,l/5);
  const rings=[octXY(w-2*b,h-2*b,b*.35,-l/2),octXY(w,h,b,-l/2+b),octXY(w,h,b,l/2-b),octXY(w-2*b,h-2*b,b*.35,l/2)];
  const g=new Geo(); g.face(rings[0],[0,0,-1]); g.face(rings.at(-1),[0,0,1]);
  for(let r=0;r<rings.length-1;r++) for(let i=0;i<8;i++){const j=(i+1)%8;g.closedFace([rings[r][i],rings[r][j],rings[r+1][j],rings[r+1][i]],[0,0,0]);}
  return g;
}
const block=(name,mat,x,y,z,w,h,l,b=.025)=>part(name,bevelBox(w,h,l,b),mat,[x,y,z]);
function cylinder(radius,length,segments=12,axis='x',radiusEnd=radius) {
  const map = (a,b,c) => axis==='x'?[c,a,b]:axis==='y'?[a,c,b]:[a,b,c];
  const rings=[[],[]];
  for(let i=0;i<segments;i++) { const t=2*PI*i/segments; rings[0].push(map(Math.cos(t)*radius,Math.sin(t)*radius,-length/2)); rings[1].push(map(Math.cos(t)*radiusEnd,Math.sin(t)*radiusEnd,length/2)); }
  const g=new Geo();g.closedFace(rings[0], [0,0,0]);g.closedFace(rings[1],[0,0,0]);
  for(let i=0;i<segments;i++){const j=(i+1)%segments;g.closedFace([rings[0][i],rings[0][j],rings[1][j],rings[1][i]],[0,0,0]);}return g;
}
const cyl=(name,mat,x,y,z,r,l,axis='x',segments=12,rEnd=r)=>part(name,cylinder(r,l,segments,axis,rEnd),mat,[x,y,z]);
function archMesh(inner,outer,thickness,segments=10) {
  const g=new Geo();
  for(let i=0;i<segments;i++) {
    const a=-.08+(PI+.16)*i/segments, b=-.08+(PI+.16)*(i+1)/segments;
    const p=(x,r,t)=>[x,Math.sin(t)*r,Math.cos(t)*r];
    g.face([p(-thickness/2,inner,a),p(-thickness/2,inner,b),p(-thickness/2,outer,b),p(-thickness/2,outer,a)],[-1,0,0]);
    g.face([p(thickness/2,inner,a),p(thickness/2,inner,b),p(thickness/2,outer,b),p(thickness/2,outer,a)],[1,0,0]);
    g.face([p(-thickness/2,outer,a),p(-thickness/2,outer,b),p(thickness/2,outer,b),p(thickness/2,outer,a)],[0,Math.sin((a+b)/2),Math.cos((a+b)/2)]);
    g.face([p(-thickness/2,inner,a),p(-thickness/2,inner,b),p(thickness/2,inner,b),p(thickness/2,inner,a)],[0,-Math.sin((a+b)/2),-Math.cos((a+b)/2)]);
  }return g;
}
function ringMesh(inner,outer,length,segments=12) {
  const g=new Geo();
  for(let i=0;i<segments;i++) {const a=2*PI*i/segments,b=2*PI*(i+1)/segments,p=(x,r,t)=>[x,Math.cos(t)*r,Math.sin(t)*r];
    for(const s of [-1,1])g.face([p(s*length/2,inner,a),p(s*length/2,inner,b),p(s*length/2,outer,b),p(s*length/2,outer,a)],[s,0,0]);
    g.face([p(-length/2,outer,a),p(-length/2,outer,b),p(length/2,outer,b),p(length/2,outer,a)],[0,Math.cos((a+b)/2),Math.sin((a+b)/2)]);
  }return g;
}
function wheel(name,x,y,z,r,w,offroad=false) {
  const ch=[cyl('Шина','rubber',0,0,0,r,w,'x',12),part('Боковины',ringMesh(r*.65,r*.96,w+.008),'rubberSide')];
  for(const s of [-1,1]) {
    ch.push(cyl('Утопленный диск','rimDark',s*(w/2+.006),0,0,r*.62,.016),part('Обод',ringMesh(r*.49,r*.63,.028),'alloy',[s*(w/2+.023),0,0]),cyl('Ступица','alloy',s*(w/2+.042),0,0,r*.20,.045,'x',8));
    for(let j=0;j<5;j++) {
      const a=2*PI*j/5, len=r*.36, center=r*.36;
      const bar=block('Спица '+(j+1),'alloy',s*(w/2+.025),Math.cos(a)*center,Math.sin(a)*center,.025,len,.07,.007);
      bar.rotation=[Math.sin(a/2),0,0,Math.cos(a/2)];ch.push(bar);
      ch.push(cyl('Болт '+(j+1),'rimDark',s*(w/2+.069),Math.cos(a)*r*.12,Math.sin(a)*r*.12,r*.025,.012,'x',6));
    }
  }
  if(offroad) for(let i=0;i<12;i++) {
    const a=2*PI*i/12, lug=block('Грунтозацеп '+i,'rubberSide',0,Math.cos(a)*(r-.006),Math.sin(a)*(r-.006),w*.92,.035,r*.21,.004);
    lug.rotation=[Math.sin(a/2),0,0,Math.cos(a/2)];ch.push(lug);
  }
  return group(name,ch,[x,y,z]);
}
function cabin({w,bottom,roof,front,rear,roofFront,roofRear,roofW,split}) {
  const outline=(width,frontZ,rearZ,y,c)=>[[-width/2+c,y,rearZ],[width/2-c,y,rearZ],[width/2,y,rearZ+c],[width/2,y,frontZ-c],[width/2-c,y,frontZ],[-width/2+c,y,frontZ],[-width/2,y,frontZ-c],[-width/2,y,rearZ+c]];
  const lo=outline(w,front,rear,bottom,.07), hi=outline(roofW,roofFront,roofRear,roof,.055),g=new Geo(),center=[0,(bottom+roof)/2,(front+rear)/2];
  g.closedFace(lo,center);g.closedFace(hi,center);
  for(let i=0;i<8;i++){const j=(i+1)%8;g.closedFace([lo[i],lo[j],hi[j],hi[i]],center);}
  const ch=[part('Стойки и рамки окон',g,'paint')];
  const y0=bottom+.105,y1=roof-.10,t0=(y0-bottom)/(roof-bottom),t1=(y1-bottom)/(roof-bottom);
  const x0=lerp(w,roofW,t0)/2-.12,x1=lerp(w,roofW,t1)/2-.10;
  const f0=lerp(front,roofFront,t0)+.013,f1=lerp(front,roofFront,t1)+.013;
  const r0=lerp(rear,roofRear,t0)-.013,r1=lerp(rear,roofRear,t1)-.013;
  ch.push(part('Лобовое стекло — наклонная плоскость',new Geo().face([[-x0,y0,f0],[x0,y0,f0],[x1,y1,f1],[-x1,y1,f1]],[0,.2,1]),'glass'));
  ch.push(part('Заднее стекло — наклонная плоскость',new Geo().face([[-x0,y0,r0],[x0,y0,r0],[x1,y1,r1],[-x1,y1,r1]],[0,.2,-1]),'glass'));
  for(const s of [-1,1]) {
    const sx0=s*(lerp(w,roofW,t0)/2+.007),sx1=s*(lerp(w,roofW,t1)/2+.007);
    const fp0=lerp(front,roofFront,t0)-.12,fp1=lerp(front,roofFront,t1)-.11;
    const rp0=lerp(rear,roofRear,t0)+.12,rp1=lerp(rear,roofRear,t1)+.11;
    const sep=split??(fp1+rp1)/2;
    const twoWindows=sep-.07>Math.max(rp0,rp1);
    ch.push(part((s<0?'Левое':'Правое')+' переднее стекло',new Geo().face([[sx0,y0,twoWindows?sep+.045:rp0],[sx0,y0,fp0],[sx1,y1,fp1],[sx1,y1,twoWindows?sep+.045:rp1]],[s,.08,0]),'glass'));
    if(twoWindows)ch.push(part((s<0?'Левое':'Правое')+' заднее стекло',new Geo().face([[sx0,y0,rp0],[sx0,y0,sep-.045],[sx1,y1,sep-.045],[sx1,y1,rp1]],[s,.08,0]),'glass'));
  }
  ch.push(block('Крыша','paint',0,roof+.025,(roofFront+roofRear)/2,roofW+.02,.075,roofFront-roofRear+.04,.025));
  return group('Кабина',ch);
}

const palettes={
  paint:{color:[.98,.40,.105,1],roughness:.62},
  accent:{color:[.95,.74,.37,1],roughness:.7},
  trim:{color:[.065,.078,.074,1],roughness:.92},
  rubber:{color:[.033,.043,.042,1],roughness:1},
  rubberSide:{color:[.063,.074,.070,1],roughness:.97},
  alloy:{color:[.66,.69,.62,1],roughness:.45,metallic:.3},
  rimDark:{color:[.13,.16,.15,1],roughness:.75,metallic:.1},
  glass:{color:[.065,.13,.145,1],roughness:.24,metallic:.18},
  light:{color:[1,.9,.65,1],roughness:.3,emissive:[.3,.23,.10]},
  redLight:{color:[.72,.075,.025,1],roughness:.4,emissive:[.12,.009,.002]},
  amber:{color:[.98,.45,.025,1],roughness:.45},
  red:{color:[.9,.035,.025,1],roughness:.35,emissive:[.16,.005,.002]},
  blue:{color:[.04,.33,.85,1],roughness:.35,emissive:[.003,.04,.16]},
  white:{color:[.91,.91,.81,1],roughness:.67},
  marking:{color:[.78,.82,.70,1],roughness:.85},
};

function runningGear({x,z,y,r,w,offroad}) {
  const wheels=[],fenders=[];
  for(const s of [-1,1])for(const end of [-1,1]) {
    wheels.push(wheel(`${end>0?'Переднее':'Заднее'} ${s<0?'левое':'правое'} колесо`,s*x,y,end*z,r,w,offroad));
    fenders.push(part('Расширитель арки',archMesh(r+.018,r+.102,w*.60,10),'trim',[s*(x-.025),y,end*z]));
  }
  return {wheels:group('Колеса — независимые узлы',wheels),fenders:group('Открытые расширители арок',fenders)};
}
function mirrors(w,y,z) {return [-1,1].flatMap(s=>[block('Кронштейн зеркала','trim',s*(w/2+.065),y-.035,z,.18,.055,.055,.008),block('Корпус зеркала','trim',s*(w/2+.14),y,z,.14,.12,.22,.02),block('Стекло зеркала','alloy',s*(w/2+.14),y,z-.116,.09,.075,.009,.001)]);}
function handles(w,y,zs) {return [-1,1].flatMap(s=>zs.map(z=>block('Ручка двери','trim',s*(w/2+.01),y,z,.027,.042,.19,.009)));}

function comet() {
  const gear=runningGear({x:.84,z:1.05,y:.41,r:.39,w:.25,offroad:false});
  const body=[block('Основной кузов','paint',0,.675,0,1.47,.52,3.28,.065),block('Подрамник','trim',0,.325,0,1.22,.15,2.96,.025),
    block('Капот','paint',0,.976,1.03,1.43,.105,1.11,.035),block('Передняя полоса капота','accent',0,1.034,1.44,1.35,.012,.16,.003),
    cabin({w:1.42,bottom:.94,roof:1.66,front:.65,rear:-1.3,roofFront:.15,roofRear:-1.00,roofW:1.18,split:-.37}),
    block('Передний бампер','trim',0,.53,1.71,1.58,.23,.22,.04),block('Задний бампер','trim',0,.52,-1.71,1.57,.22,.22,.04),
    block('Решетка радиатора','trim',0,.79,1.649,.89,.17,.045,.01),block('Перемычка решетки','rimDark',0,.80,1.678,.72,.025,.018,.005),
    block('Задняя панель','trim',0,.80,-1.652,.91,.12,.032,.006),block('Номер','marking',0,.52,-1.836,.34,.105,.014,.003),
    ...mirrors(1.42,1.12,.48),...handles(1.47,.91,[-.20,-.86]),
    block('Накладка порога слева','trim',-.755,.51,0,.11,.13,1.23,.018),block('Накладка порога справа','trim',.755,.51,0,.11,.13,1.23,.018),
  ];
  for(const s of [-1,1])body.push(block('Фара','light',s*.585,.84,1.661,.29,.16,.049,.012),block('Передний поворотник','amber',s*.72,.75,1.669,.10,.09,.05,.006),block('Стоп-сигнал','redLight',s*.61,.82,-1.67,.22,.22,.05,.009));
  return {id:'comet-mk2',title:'COMET MK2',subtitle:'Городской хэтчбек',description:'Короткая корма, низкий капот и сильный наклон лобового стекла. Ближе всего к оранжевой машине из референса.',color:'#fa661b',traits:['Маневренный','Компактный','Близок к референсу'],dimensions:'3,7 × 2,1 × 1,7 м',mountY:1.75,root:group('COMET_MK2',[group('Кузов',body),gear.fenders,gear.wheels]),materials:structuredClone(palettes)};
}
function scout() {
  const gear=runningGear({x:.96,z:1.19,y:.48,r:.46,w:.31,offroad:true});
  const body=[block('Рама','trim',0,.39,0,1.37,.20,3.48,.025),block('Основной кузов','paint',0,.83,0,1.62,.55,3.65,.065),
    block('Капот','paint',0,1.15,1.12,1.55,.15,1.15,.035),cabin({w:1.58,bottom:1.10,roof:1.97,front:.60,rear:-1.50,roofFront:.26,roofRear:-1.29,roofW:1.39,split:-.47}),
    block('Накладка крыши','accent',0,2.025,-.51,1.40,.07,1.57,.025),
    block('Передний силовой бампер','trim',0,.65,1.91,1.85,.28,.26,.05),block('Задний силовой бампер','trim',0,.66,-1.91,1.84,.24,.23,.04),
    block('Решетка радиатора','trim',0,.99,1.846,.91,.25,.05,.015),...mirrors(1.58,1.32,.47),...handles(1.62,1.06,[-.27,-1.01]),
    block('Подножка слева','trim',-.91,.52,0,.25,.12,1.59,.022),block('Подножка справа','trim',.91,.52,0,.25,.12,1.59,.022),
    block('Люк бензобака','accent',-.82,.99,-1.14,.025,.19,.22,.009),
  ];
  for(const s of [-1,1]){
    body.push(block('Фара','light',s*.61,1.01,1.852,.29,.25,.05,.015),block('Стоп-сигнал','redLight',s*.65,1.00,-1.844,.21,.25,.05,.01),cyl('Противотуманная фара','light',s*.40,.76,2.065,.10,.06,'z',8),
      cyl('Вертикаль защитной дуги','trim',s*.65,.91,2.055,.035,.40,'y',8),block('Рейлинг','trim',s*.59,2.13,-.51,.075,.12,1.69,.018));
  }
  body.push(cyl('Перемычка защитной дуги','trim',0,1.12,2.055,.035,1.32,'x',8),block('Передняя поперечина багажника','trim',0,2.13,.23,1.22,.07,.07,.012),block('Задняя поперечина багажника','trim',0,2.13,-1.25,1.22,.07,.07,.012));
  const spare=wheel('Запасное колесо',0,1.23,-1.99,.37,.21,true);spare.rotation=[0,Math.sin(PI/4),0,Math.cos(PI/4)];
  const materials=structuredClone(palettes);materials.paint.color=[.52,.61,.29,1];materials.accent.color=[.86,.79,.56,1];
  return {id:'dune-scout',title:'DUNE SCOUT',subtitle:'Высокий внедорожник',description:'Вертикальная кабина, увеличенный клиренс, наружная запаска и открытые арки. Читается как отдельный класс даже издалека.',color:'#859c4a',traits:['Высокая посадка','Проходимость','Экспедиционный'],dimensions:'4,3 × 2,4 × 2,2 м',mountY:2.10,root:group('DUNE_SCOUT',[group('Кузов',body),gear.fenders,gear.wheels,spare]),materials};
}
function brute() {
  const gear=runningGear({x:1.055,z:1.44,y:.50,r:.48,w:.34,offroad:true});
  const body=[block('Лонжероны рамы','trim',0,.37,0,1.60,.22,4.13,.025),block('Основной кузов','paint',0,.81,0,1.88,.56,4.36,.075),
    block('Длинный капот','paint',0,1.135,1.47,1.82,.17,1.43,.045),cabin({w:1.81,bottom:1.08,roof:1.91,front:.77,rear:-.71,roofFront:.30,roofRear:-.57,roofW:1.61,split:-.47}),
    block('Пол грузового отсека','rimDark',0,1.111,-1.44,1.53,.035,1.27,.015),
    block('Левый борт кузова','paint',-.853,1.255,-1.43,.185,.35,1.48,.035),block('Правый борт кузова','paint',.853,1.255,-1.43,.185,.35,1.48,.035),
    block('Задний откидной борт','paint',0,1.23,-2.10,1.73,.34,.19,.035),block('Левая накладка борта','trim',-.853,1.44,-1.43,.20,.035,1.47,.009),block('Правая накладка борта','trim',.853,1.44,-1.43,.20,.035,1.47,.009),
    block('Ручка грузового борта','trim',0,1.27,-2.20,.27,.06,.027,.008),
    block('Передний силовой бампер','trim',0,.63,2.26,2.03,.30,.27,.05),block('Задний силовой бампер','trim',0,.64,-2.27,2.00,.25,.24,.045),
    block('Большая решетка','trim',0,.97,2.193,1.32,.33,.055,.016),...mirrors(1.81,1.34,.58),...handles(1.88,1.04,[-.34]),
    block('Подножка слева','trim',-1.005,.53,.03,.22,.12,1.75,.022),block('Подножка справа','trim',1.005,.53,.03,.22,.12,1.75,.022),
    cyl('Выхлопная труба слева','rimDark',-.75,.46,-2.27,.067,.25,'z',8),cyl('Выхлопная труба справа','rimDark',.75,.46,-2.27,.067,.25,'z',8),
  ];
  for(let j=-1;j<=1;j++)body.push(block('Ребро решетки','alloy',0,.97+j*.09,2.230,1.18,.025,.025,.006));
  for(const s of [-1,1])body.push(block('Квадратная фара','light',s*.79,1.00,2.20,.23,.25,.055,.012),block('Стоп-сигнал','redLight',s*.81,1.02,-2.205,.20,.26,.045,.01),block('Вентиляция капота','trim',s*.54,1.224,1.04,.27,.017,.34,.008),block('Клык бампера','alloy',s*.61,.65,2.417,.13,.20,.06,.016));
  const materials=structuredClone(palettes);materials.paint.color=[.71,.27,.15,1];materials.accent.color=[.76,.60,.36,1];
  return {id:'brute-runner',title:'BRUTE RUNNER',subtitle:'Тяжелый пикап',description:'Длинный капот, широкая колея и настоящий открытый кузов. Масса читается по пропорциям, без увеличения всех деталей одинаково.',color:'#b54526',traits:['Тяжелый','Широкая колея','Открытый кузов'],dimensions:'4,8 × 2,6 × 2,0 м',mountY:2.00,root:group('BRUTE_RUNNER',[group('Кузов',body),gear.fenders,gear.wheels]),materials};
}
function interceptor() {
  const gear=runningGear({x:.87,z:1.21,y:.41,r:.39,w:.25,offroad:false});
  const body=[block('Основной кузов','paint',0,.685,0,1.58,.53,3.86,.06),block('Подрамник','trim',0,.32,0,1.32,.14,3.56,.025),
    block('Черный капот','trim',0,.996,1.27,1.51,.10,1.23,.03),block('Черный багажник','trim',0,.993,-1.55,1.50,.10,.66,.028),
    cabin({w:1.50,bottom:.96,roof:1.69,front:.67,rear:-1.24,roofFront:.14,roofRear:-.78,roofW:1.25,split:-.34}),
    block('Черная крыша','trim',0,1.743,-.32,1.25,.055,.94,.02),block('Передний бампер','trim',0,.53,2.01,1.73,.22,.23,.035),block('Задний бампер','trim',0,.53,-2.01,1.72,.22,.23,.035),
    block('Решетка','trim',0,.82,1.95,1.02,.22,.05,.012),...mirrors(1.5,1.16,.48),...handles(1.58,.94,[-.16,-.93]),block('Основание мигалок','trim',0,1.82,-.32,1.04,.085,.28,.02),
    block('Красный проблесковый маяк','red',-.31,1.91,-.32,.37,.13,.24,.025),block('Синий проблесковый маяк','blue',.31,1.91,-.32,.37,.13,.24,.025),block('Середина световой балки','alloy',0,1.90,-.32,.20,.10,.21,.015),
  ];
  for(const s of [-1,1])body.push(block('Фара','light',s*.66,.85,1.958,.24,.20,.055,.012),block('Стоп-сигнал','redLight',s*.66,.83,-1.957,.23,.18,.05,.01),block('Полицейская полоса','trim',s*.802,.78,-.15,.022,.16,1.42,.004),cyl('Эмблема на двери','accent',s*.818,.86,-.15,.13,.018,'x',6));
  const materials=structuredClone(palettes);materials.paint.color=[.90,.91,.83,1];
  return {id:'interceptor',title:'INTERCEPTOR',subtitle:'Полиция · дополнительный концепт',description:'Трехобъемный седан с контрастным капотом, дверной полосой и отдельной световой балкой. Силуэт отличается от гражданского хэтчбека.',color:'#e6e8d4',traits:['Седан','Полицейская ливрея','Световая балка'],dimensions:'4,3 × 2,1 × 2,0 м',mountY:1.78,root:group('INTERCEPTOR',[group('Кузов',body),gear.fenders,gear.wheels]),materials};
}

export function createTurret() {
  return group('Съемная турель',[
    cyl('Основание крепления','trim',0,.045,0,.23,.09,'y',12),cyl('Поворотная платформа','rimDark',0,.12,0,.19,.09,'y',10),
    block('Бронекожух','paint',0,.24,-.025,.48,.23,.54,.045),block('Верхняя панель','accent',0,.365,-.025,.42,.035,.44,.015),
    cyl('Ствол','rimDark',0,.255,.53,.047,.70,'z',8),cyl('Дульный тормоз','trim',0,.255,.93,.075,.15,'z',8),
    block('Боезапас','trim',-.31,.24,-.06,.16,.21,.32,.025),block('Прицел','trim',0,.41,.12,.09,.055,.17,.01),
  ]);
}
function turbine() {
  const blades=[];
  for(let i=0;i<3;i++) {
    const g=new Geo(),front=.055,back=-.055;
    const shape=[[-.13,.18],[-.24,.69],[-.18,2.95],[.04,3.27],[.15,2.97],[.24,.69]];
    const a=shape.map(([x,y])=>[x,y,front]),b=shape.map(([x,y])=>[x,y,back]);
    g.face(a,[0,0,1]);g.face(b,[0,0,-1]);
    for(let j=0;j<shape.length;j++){let k=(j+1)%shape.length;g.closedFace([a[j],a[k],b[k],b[j]],[0,1.5,0]);}
    const blade=part('Лопасть '+(i+1),g,'white');blade.rotation=[0,0,Math.sin(i*PI/3),Math.cos(i*PI/3)];blades.push(blade);
  }
  const rotor=group('Ротор — вращение вокруг Z',[...blades,cyl('Кок винта','white',0,0,.12,.24,.34,'z',10,.14)],[0,7.65,.64]);rotor.animate='rotor';
  const root=group('WIND_TURBINE',[block('Бетонное основание','alloy',0,.12,0,1.6,.24,1.6,.05),cyl('Коническая башня','white',0,3.92,0,.28,7.6,'y',12,.16),
    block('Техническая дверь','trim',0,.74,.273,.20,.68,.025,.015),block('Гондола','white',0,7.65,-.12,.64,.58,1.28,.12),rotor]);
  return {id:'wind-turbine',title:'ВЕТРОТУРБИНА',subtitle:'Окружение · отдельный объект',description:'Коническая башня и три профилированные лопасти. Ротор вынесен в отдельный узел и вращается в просмотрщике; glTF содержит циклическую анимацию.',color:'#e8e8d2',traits:['Отдельный ротор','Анимация glTF','Объект окружения'],dimensions:'Ø 6,6 × 11,0 м',mountY:0,root,materials:structuredClone(palettes),isProp:true};
}
export function createModels() {return [comet(),scout(),brute(),interceptor(),turbine()];}

export function modelStats(model,includeTurret=false) {
  let triangles=0,meshCount=0;const walk=n=>{if(n.geometry){meshCount++;triangles+=n.geometry.indices.length/3;}for(const c of n.children??[])walk(c);};
  walk(model.root);if(includeTurret&&!model.isProp&&model.id!=='interceptor')walk(createTurret());return {triangles,meshes:meshCount};
}
function bytesToBase64(bytes) {
  if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');
  let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);
}
export function hexToColor(hex) {const h=hex.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).concat(1);}

/** Pure glTF 2.0, embedded binary buffer, separate named transform nodes.
 * No engine extensions, textures, external resources, or runtime dependencies. */
export function exportModelGltf(model,{paint,turret=false,turretOnly=false}={}) {
  const document={asset:{version:'2.0',generator:'DUSTLINE design-review / procedural concept generator',copyright:'Generated for this project'},scene:0,scenes:[{nodes:[0]}],nodes:[],meshes:[],materials:[],buffers:[],bufferViews:[],accessors:[],extras:{units:'metres',forward:'+Z',up:'+Y',concept:true,collisionMeshIncluded:false}};
  const materials=structuredClone(model.materials),indicesByMat={};if(paint)materials.paint.color=hexToColor(paint);
  for(const [name,mat] of Object.entries(materials)) {indicesByMat[name]=document.materials.length;document.materials.push({name,pbrMetallicRoughness:{baseColorFactor:mat.color,metallicFactor:mat.metallic??0,roughnessFactor:mat.roughness??.7},...(mat.emissive?{emissiveFactor:mat.emissive}:{}),doubleSided:false});}
  const buffers=[];let byteOffset=0;
  const accessor=(array,type,componentType,target,min,max)=>{
    const data=componentType===5123?new Uint16Array(array):new Float32Array(array),raw=new Uint8Array(data.buffer),padding=(4-raw.byteLength%4)%4;
    const view=document.bufferViews.length;document.bufferViews.push({buffer:0,byteOffset,byteLength:raw.byteLength,...(target?{target}:{})});buffers.push(raw,new Uint8Array(padding));byteOffset+=raw.byteLength+padding;
    const index=document.accessors.length;document.accessors.push({bufferView:view,componentType,count:array.length/({SCALAR:1,VEC3:3,VEC4:4}[type]),type,...(min?{min}:{}),...(max?{max}:{})});return index;
  };
  let rotorNode;
  const walk=node=>{
    const index=document.nodes.length,out={name:node.name};document.nodes.push(out);
    if(node.translation)out.translation=node.translation;if(node.rotation)out.rotation=node.rotation;
    if(node.animate==='rotor')rotorNode=index;
    if(node.geometry) {
      const g=node.geometry,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];g.positions.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v);});
      const position=accessor(g.positions,'VEC3',5126,34962,min,max),normal=accessor(g.normals,'VEC3',5126,34962),idx=accessor(g.indices,'SCALAR',5123,34963);
      out.mesh=document.meshes.length;document.meshes.push({name:node.name,primitives:[{attributes:{POSITION:position,NORMAL:normal},indices:idx,material:indicesByMat[node.material],mode:4}]});
    }
    if(node.children?.length)out.children=node.children.map(walk);return index;
  };
  let root=model.root;
  if(turretOnly)root=createTurret();
  else if(turret&&!model.isProp&&model.id!=='interceptor')root=group(model.root.name,[...model.root.children,group('Съемный модуль вооружения',[createTurret()],[0,model.mountY,0])]);
  walk(root);
  if(rotorNode!==undefined) {
    const time=accessor([0,2,4,6,8],'SCALAR',5126,undefined,[0],[8]),quats=[];
    for(let i=0;i<5;i++)quats.push(0,0,Math.sin(i*PI/4),Math.cos(i*PI/4));
    const values=accessor(quats,'VEC4',5126);document.animations=[{name:'Вращение ротора — 8 секунд',samplers:[{input:time,output:values,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:rotorNode,path:'rotation'}}]}];
  }
  const merged=new Uint8Array(byteOffset);let offset=0;for(const b of buffers){merged.set(b,offset);offset+=b.byteLength;}
  document.buffers=[{byteLength:byteOffset,uri:'data:application/octet-stream;base64,'+bytesToBase64(merged)}];return document;
}
