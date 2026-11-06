import type { CarSpec } from './types';

/** Traffic keeps its own catalogue, so service vehicles never alter save unlocks. */
export const CIVILIAN_FLEET: CarSpec[] = [
  {id:'civil-sedan',name:'REGENT',subtitle:'Городской седан',price:0,color:'#a34e46',speed:24,handling:1,armor:95,mass:1150,width:2.05,length:4.5,bodyStyle:'hatch',visualVariant:'sedan'},
  {id:'civil-wagon',name:'TRAIL ESTATE',subtitle:'Семейный универсал',price:0,color:'#8a9c5d',speed:23,handling:1,armor:110,mass:1250,width:2.05,length:4.7,bodyStyle:'hatch',visualVariant:'wagon'},
  {id:'civil-convertible',name:'SUNSET',subtitle:'Открытое купе',price:0,color:'#dc7958',speed:27,handling:1.2,armor:85,mass:1000,width:2.05,length:4.3,bodyStyle:'coupe',visualVariant:'convertible'},
  {id:'civil-minibus',name:'SHUTTLE',subtitle:'Пассажирский микроавтобус',price:0,color:'#6da3a1',speed:21,handling:.9,armor:130,mass:1700,width:2.3,length:5.2,bodyStyle:'van',visualVariant:'minibus'},
  {id:'civil-stepvan',name:'PARCEL',subtitle:'Развозной фургон',price:0,color:'#e1b653',speed:20,handling:.85,armor:140,mass:1900,width:2.3,length:5.2,bodyStyle:'van',visualVariant:'stepvan'},
  {id:'civil-camper',name:'WANDERER',subtitle:'Дом на колёсах',price:0,color:'#c47e59',speed:19,handling:.8,armor:145,mass:2100,width:2.4,length:5.6,bodyStyle:'van',visualVariant:'camper'},
  {id:'service-tow',name:'RECOVERY',subtitle:'Эвакуатор',price:0,color:'#d8a83e',speed:21,handling:.9,armor:155,mass:2100,width:2.3,length:5.5,bodyStyle:'pickup',visualVariant:'tow'},
  {id:'service-fire',name:'LADDER 4',subtitle:'Пожарная машина',price:0,color:'#bd4836',speed:22,handling:.8,armor:190,mass:2900,width:2.45,length:6.4,bodyStyle:'van',visualVariant:'fire',extraAxles:1},
  {id:'service-ambulance',name:'RESCUE',subtitle:'Скорая помощь',price:0,color:'#dedbc8',speed:26,handling:.95,armor:140,mass:2100,width:2.35,length:5.7,bodyStyle:'van',visualVariant:'ambulance'},
  {id:'service-garbage',name:'CLEANLINE',subtitle:'Мусоровоз',price:0,color:'#74a175',speed:18,handling:.75,armor:210,mass:3100,width:2.5,length:6.5,bodyStyle:'van',visualVariant:'garbage',extraAxles:1},
  {id:'service-mixer',name:'CONCRETE',subtitle:'Бетономешалка',price:0,color:'#d58a42',speed:18,handling:.75,armor:200,mass:3200,width:2.5,length:6.6,bodyStyle:'van',visualVariant:'mixer',extraAxles:1},
  {id:'service-bus',name:'CITY LINK',subtitle:'Городской автобус',price:0,color:'#619e9d',speed:21,handling:.8,armor:175,mass:2700,width:2.45,length:7.1,bodyStyle:'van',visualVariant:'bus'},
];
