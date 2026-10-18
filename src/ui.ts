import { CARS, PAINTS, UPGRADE_NAMES, CHALLENGES, TURRET_PRICE, carUpgrades, upgradeCost, challengeProgress, turretAvailable, turretCoolingCost } from './types';
import { PICKUP_INFO } from './pickups';
import type { GameState, SaveData, UIActions, GameUI, MapData, RadarMarker, UpgradeKey, HandlingProfileId, WeaponKind, GarageTab, AimAssist, CheatKey, AudioChannel, CarSpec } from './types';

const upgradeKeys: UpgradeKey[] = ['engine', 'armor', 'tires', 'nitro', 'handling'];
const money = (value: number) => Math.max(0, Math.floor(value)).toLocaleString('ru-RU');
const clock = (value: number) => `${Math.floor(Math.max(0, value) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, value) % 60).toString().padStart(2, '0')}`;
const percent = (value: number) => Math.min(100, Math.max(0, value));
const paintNames: Record<string,string> = { '#fa661b':'Оранжевый', '#859c4a':'Олива', '#b54526':'Терракота', '#ded9c9':'Слоновая кость', '#8aafbf':'Лёд', '#b69ad0':'Лаванда', '#e6ef64':'Лайм', '#252d32':'Графит' };
const biomeNames = { city: 'ГОРОД', desert: 'ПУСТЫНЯ', fields: 'ПОЛЯ' };
const handlingDescriptions: Record<HandlingProfileId, string> = {
  arcade: 'Быстрые реакции и помощь в стабилизации. Удобная основа для погони.',
  balanced: 'Плавный баланс сцепления и управляемого заноса. Предсказуемо на дороге и живо в поворотах.',
  drift: 'Проще сорвать заднюю ось и удерживать длинный занос. Для экспериментов с контррулением.',
  grip: 'Больше сцепления и точнее траектория. Для чистых поворотов и спокойного теста машины.'
};
const tabLabels: Record<GarageTab, string> = { garage: 'ГАРАЖ', cars: 'АВТОМОБИЛИ', tuning: 'ТЮНИНГ', body: 'КУЗОВ' };
const tabSubtitles: Record<GarageTab, string> = { garage: 'Подготовь машину к следующему заезду.', cars: 'Выбери машину для заезда.', tuning: 'Улучши характеристики машины.', body: 'Настрой внешний вид машины.' };
const tabIcons = { garage: 'M2 10L12 2l10 8v12h-5v-9H7v9H2zm7 6h6v6H9z', cars: 'M5 5h14l3 8v8h-4v-3H6v3H2v-8zm1 2l-2 6h16l-2-6zM5 14v3h3v-3zm11 0v3h3v-3z', tuning: 'M14 2l-2 5 5 5 5-2-1 6-5 3-5-2-7 7-4-4 7-7-1-5 3-5z', body: 'M9 1h7v4H9zM8 6h9l3 5v11H5V11zm-5 4H0v3h3zm17-4h4v3h-4z' };
const upgradeDescriptions: Record<UpgradeKey, string> = { engine: 'Мощность и максимальная скорость', armor: 'Прочность корпуса', tires: 'Сцепление на дороге', nitro: 'Расход и восстановление ускорения', handling: 'Отклик руля и устойчивость в повороте' };
const assistOptions = '<option value="off">Выключена · точное наведение</option><option value="weak">Слабая · небольшая помощь</option><option value="standard">Стандартная · удобный захват</option>';
const cheatLabels: Record<CheatKey, string> = { invincible: 'Бессмертие', unlimitedNitro: 'Бесконечное нитро', unlimitedAmmo: 'Бесконечные ракеты и гранаты', noOverheat: 'Турель без перегрева' };
function challengeCards() {
  return `<div class="dl-challenges">${CHALLENGES.map(challenge => `<article class="dl-challenge" data-challenge="${challenge.id}"><div><span>${challenge.difficulty}</span><b>${CARS.find(car => car.id === challenge.carId)?.name || challenge.carId}</b></div><h3>${challenge.title}</h3><p>${challenge.description}</p><progress max="${challenge.target}" value="0" aria-label="${challenge.title}: прогресс"></progress><small data-challenge-progress>0 / ${challenge.target}</small></article>`).join('')}</div>`;
}
function upgradeEffect(spec: CarSpec, key: UpgradeKey, level: number) {
  const next = Math.min(3, level + 1), pair = (a: string, b: string) => level >= 3 ? a : `${a} → ${b}`;
  switch (key) {
    case 'engine': return `Предел скорости: ${pair(`${Math.round(spec.speed * (1 + level * .085) * 3.6)}`, `${Math.round(spec.speed * (1 + next * .085) * 3.6)}`)} км/ч при исправном моторе. Мощность: ${pair(`+${level * 10}%`, `+${next * 10}%`)}.`;
    case 'armor': return `Прочность: ${pair(`${spec.armor + level * 30}`, `${spec.armor + next * 30}`)} HP.`;
    case 'tires': return `Сцепление: ${pair(`+${(level * 6.5).toLocaleString('ru-RU')}%`, `+${(next * 6.5).toLocaleString('ru-RU')}%`)}.`;
    case 'nitro': return `Расход: ${pair(`${31 - level * 4}`, `${31 - next * 4}`)} /с. Восстановление: ${pair(`${7 + level * 2}`, `${7 + next * 2}`)} /с.`;
    case 'handling': return `Отклик руля: ${pair(`+${level * 10}%`, `+${next * 10}%`)}. Устойчивость: ${pair(`+${level * 5}%`, `+${next * 5}%`)}.`;
  }
}
function drivingControls(scope: string) {
  return `<div class="dl-driving-controls"><span class="dl-test-kicker">НАСТРОЙКИ ЗАЕЗДА</span><label for="${scope}-handling">Характер машины</label><select id="${scope}-handling" data-setting="handling"><option value="arcade">Аркада · рекомендуется</option><option value="balanced">Баланс · плавно и устойчиво</option><option value="drift">Дрифт · больше заноса</option><option value="grip">Сцепление · точнее повороты</option></select><p data-handling-description>${handlingDescriptions.arcade}</p><label for="${scope}-traffic">Сторона движения</label><select id="${scope}-traffic" data-setting="traffic"><option value="right">Правостороннее</option><option value="left">Левостороннее</option></select><label>Преследование</label><button type="button" class="dl-pursuit-toggle" data-action="pursuit" data-pursuit-toggle aria-pressed="true">ПОЛИЦИЯ ВКЛЮЧЕНА</button><label>Оружие на ЛКМ</label><div class="dl-weapon-switch"><button type="button" data-action="weapon" data-weapon="turret" aria-pressed="true" title="Турель — клавиша 1">1 Турель <small>∞</small></button><button type="button" data-action="weapon" data-weapon="rocket" aria-pressed="false" title="Ракеты — клавиша 2">2 Ракеты <small data-rocket-count>0</small></button></div><p>Турель покупается и устанавливается в тюнинге. 1 / 2 — выбор оружия. Ракеты при подборе пополняют запас.</p><details class="dl-settings-details" open><summary>Помощь прицеливания</summary><label for="${scope}-turret-assist">Турель</label><select id="${scope}-turret-assist" data-setting="assist" data-weapon="turret">${assistOptions}</select><label for="${scope}-rocket-assist">Ракеты</label><select id="${scope}-rocket-assist" data-setting="assist" data-weapon="rocket">${assistOptions}</select><p>Меняет помощь при выборе цели. Выпущенная ракета продолжает самонаведение.</p></details><details class="dl-settings-details"><summary>Звук</summary><button type="button" class="dl-settings-music" data-action="music" data-music-toggle>МУЗЫКА ВКЛЮЧЕНА</button>${(['music','sfx','engine'] as const).map(channel => `<label class="dl-volume-label" for="${scope}-${channel}">${{music:'Музыка',sfx:'Выстрелы и эффекты',engine:'Двигатель'}[channel]}<output data-volume-label="${channel}">70%</output></label><input id="${scope}-${channel}" type="range" min="0" max="100" step="5" data-setting="volume" data-channel="${channel}" aria-label="Громкость: ${{music:'музыка',sfx:'эффекты',engine:'двигатель'}[channel]}">`).join('')}<p>Музыка меняется при погоне и после отрыва. Громкость эффектов и двигателя настраивается отдельно.</p></details><details class="dl-settings-details"><summary>Песочница</summary><button type="button" class="dl-pursuit-toggle" data-action="sandbox" data-sandbox-toggle aria-pressed="false">ВКЛЮЧИТЬ ПЕСОЧНИЦУ</button><p>Свободный режим для экспериментов. Прогресс заданий и рекорды в нём не засчитываются.</p><fieldset class="dl-cheats" data-sandbox-options disabled><legend>Возможности</legend>${(Object.keys(cheatLabels) as CheatKey[]).map(key => `<label class="dl-check"><input type="checkbox" data-setting="cheat" data-cheat="${key}"><span>${cheatLabels[key]}</span></label>`).join('')}<label for="${scope}-wanted">Уровень розыска</label><select id="${scope}-wanted" data-setting="wanted"><option value="-1">Обычный розыск</option>${Array.from({length:6},(_,level)=>`<option value="${level}">${level === 0 ? '0 · без розыска' : `${level} ${'★'.repeat(level)}`}</option>`).join('')}</select></fieldset></details><details class="dl-settings-details"><summary>Задания · открытие машин</summary>${challengeCards()}</details><details class="dl-settings-details"><summary>Состояние и контракт</summary><div class="dl-settings-readings"><div><span>Кузов</span><b data-health-detail="hull">100%</b></div><div><span>Двигатель</span><b data-health-detail="engine">100%</b></div><div><span>Шины</span><b data-health-detail="tires">100%</b></div></div><p data-objective-summary>Контракт появится во время заезда.</p></details><p class="dl-full-controls">WASD — газ, тормоз и руль. Shift — нитро. Space — ручник. G — гараж рядом, когда погоня закончена. Tab — полная карта. Esc — пауза. M — музыка.</p></div>`;
}
function pickupLegend() {
  const names = { cash: 'Монеты', repair: 'Красный ремкомплект с крестом', ammo: 'Гранаты', nitro: 'Синий баллон', rocket: 'Ракетница' };
  const icons = { cash: '●', repair: '✚', ammo: '▥', nitro: '▰', rocket: '➤' };
  return `<details class="dl-pickup-legend"><summary>ПРЕДМЕТЫ НА ДОРОГЕ <span>5 типов</span></summary><div>${(['cash', 'repair', 'ammo', 'nitro', 'rocket'] as const).map(kind => `<div class="dl-pickup-row"><i class="dl-pickup-icon" style="--pickup-color:${PICKUP_INFO[kind].color}" aria-hidden="true">${icons[kind]}</i><div><b>${names[kind]}</b><span>${kind === 'rocket' ? `${PICKUP_INFO[kind].label} · нажми 2 для выбора` : PICKUP_INFO[kind].message}</span></div></div>`).join('')}</div></details>`;
}

export function createUI(container: HTMLElement, actions: UIActions): GameUI {
  const root = document.createElement('div');
  root.className = 'dl-app';
  root.dataset.mode = 'garage';
  root.dataset.garageTab = 'garage';
  root.innerHTML = `
    <header class="dl-header">
      <div class="dl-brand"><span class="dl-brand-symbol" aria-hidden="true"><i></i><i></i><i></i></span><div>DUSTLINE<span class="dl-brand-caption">ЕЗЖАЙ. РИСКУЙ. ИСЧЕЗАЙ.</span></div></div>
      <div class="dl-header-tools"><div class="dl-wallet-compact" aria-label="Баланс"><span>БАЛАНС</span><b data-ui="compactCredits">800</b><span>$</span></div><button class="dl-garage-settings" type="button" data-action="settingmodal" aria-label="Настройки игры">⚙</button><span class="dl-local"><i></i> LOCAL <span>/ СОЛО</span></span><button class="dl-sound" type="button" data-action="music" aria-label="Выключить музыку"><span class="dl-sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span data-ui="musicLabel">МУЗЫКА ВКЛ</span></button></div>
    </header>
    <section class="dl-garage" data-ui="garage" aria-label="Гараж">
      <nav class="dl-garage-nav" aria-label="Разделы гаража">${(['garage','cars','tuning','body'] as const).map(tab => `<button type="button" data-action="tab" data-tab="${tab}" class="${tab === 'garage' ? 'is-active' : ''}" aria-pressed="${tab === 'garage'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${tabIcons[tab]}"/></svg>${tabLabels[tab]}</button>`).join('')}</nav>
      <div class="dl-garage-left">
        <div class="dl-garage-copy"><h1 data-ui="garageTitle">ГАРАЖ</h1><p data-ui="garageSubtitle">Подготовь машину к следующему заезду.</p><span class="dl-menu-car-name" data-ui="menuCarName">COMET</span></div>
        <div class="dl-car-info">
          <div class="dl-car-picker"><button type="button" data-action="cycle" data-step="-1" aria-label="Предыдущая машина">‹</button><h2 data-ui="carName">COMET</h2><button type="button" data-action="cycle" data-step="1" aria-label="Следующая машина">›</button></div>
          <nav class="dl-car-tabs" aria-label="Выбор автомобиля">${CARS.map((car, index) => `<button type="button" data-action="select" data-id="${car.id}" aria-label="Выбрать ${car.name}"><span>0${index + 1}</span> ${car.name}<i data-car-lock="${car.id}"></i></button>`).join('')}</nav>
          <div class="dl-car-category"><span data-ui="carClass">ГОРОД / КЛАСС 01</span><span class="dl-car-number" data-ui="carIndex">01</span></div><span class="dl-owned-status" data-ui="ownedLabel">В ТВОЁМ ГАРАЖЕ</span>
          <p class="dl-car-subtitle" data-ui="carSubtitle"></p>
          <div class="dl-specs">
            <div><span>СКОРОСТЬ</span><b data-ui="speedStat"></b><i><em data-ui="speedBar"></em></i></div>
            <div><span>УПРАВЛЕНИЕ</span><b data-ui="handlingStat"></b><i><em data-ui="handlingBar"></em></i></div>
            <div><span>БРОНЯ</span><b data-ui="armorStat"></b><i><em data-ui="armorBar"></em></i></div>
          </div>
          <button type="button" class="dl-launch" data-ui="launch" data-action="start"><span data-ui="launchLabel">НА ДОРОГУ</span><span aria-hidden="true">↗</span></button>
          <p class="dl-launch-note" data-ui="launchNote">Погоня начинается с первого поворота.</p>
        </div>
        <div class="dl-garage-challenges" data-panel="cars"><h2>ОТКРОЙ НОВЫЕ МАШИНЫ</h2><p>Награды за задания сохраняются в твоём гараже.</p>${challengeCards()}</div><div class="dl-panel-section dl-upgrade-section" data-panel="tuning"><div class="dl-upgrades">${upgradeKeys.map(key => `<button class="dl-upgrade" type="button" data-action="upgrade" data-key="${key}"><span class="dl-upgrade-symbol" aria-hidden="true">${{engine:'⚙',armor:'⬡',tires:'◉',nitro:'ϟ',handling:'↗'}[key]}</span><span class="dl-upgrade-main"><span class="dl-upgrade-name">${UPGRADE_NAMES[key]}</span><span class="dl-upgrade-tier" data-level-label="${key}">УРОВЕНЬ 0 / 3</span><span class="dl-upgrade-level" data-level="${key}"><i></i><i></i><i></i></span><span class="dl-upgrade-description">${upgradeDescriptions[key]}</span><span class="dl-upgrade-effect" data-upgrade-effect="${key}"></span></span><span class="dl-upgrade-price" data-price="${key}"></span><span class="dl-upgrade-add" aria-hidden="true">+</span></button>`).join('')}</div><p class="dl-panel-hint">Улучшения устанавливаются на выбранную машину. Максимум — три уровня.</p><section class="dl-equipment" aria-label="Вооружение"><h2>ВООРУЖЕНИЕ</h2><p data-ui="turretOwnership">Турель доступна после покупки.</p><button type="button" class="dl-equipment-buy" data-ui="turretBuy" data-action="buyTurret">КУПИТЬ ТУРЕЛЬ · ${money(TURRET_PRICE)} $</button><button type="button" class="dl-equipment-install" data-ui="turretInstall" data-action="toggleTurret" aria-pressed="false" hidden>УСТАНОВИТЬ НА ЭТУ МАШИНУ</button><p>Одна покупка для всех твоих машин. Установка на каждую машину бесплатна.</p><button type="button" class="dl-equipment-cooling" data-ui="turretUpgrade" data-action="upgradeTurret"><span>ОХЛАЖДЕНИЕ ТУРЕЛИ</span><b data-ui="turretUpgradePrice"></b><small data-ui="turretUpgradeEffect"></small></button><p>Общее улучшение для всех установленных турелей. Ускоряет охлаждение после стрельбы.</p></section></div>
        <div class="dl-panel-section dl-body-panel" data-panel="body"><div class="dl-section-title"><span>ОСНОВНОЙ ЦВЕТ</span><b data-ui="paintLabel">ЛАЙМ</b></div><div class="dl-swatches">${PAINTS.map((paint, index) => `<button type="button" data-action="paint" data-color="${paint}" style="--paint:${paint}" aria-label="${paintNames[paint] || `Цвет ${index + 1}`}"></button>`).join('')}</div><p class="dl-panel-hint">Покраска применяется сразу и сохраняется для этой машины.</p><button type="button" class="dl-body-done" data-action="tab" data-tab="garage">ГОТОВО <span>↗</span></button></div>
      </div>
      <div class="dl-garage-notice" data-ui="garageNotice" role="status" hidden></div>
      <aside class="dl-garage-panel">
        <div class="dl-wallet"><span class="dl-eyebrow">ТВОЙ БАЛАНС</span><strong><span data-ui="credits">800</span><small>$</small></strong><span class="dl-wallet-best">Рекорд <b data-ui="garageBest">00:00</b></span></div>
        <div class="dl-repair-block"><div class="dl-section-title"><span>03 / СОСТОЯНИЕ</span><b data-ui="condition">100%</b></div><div class="dl-garage-condition"><i data-ui="garageHealth"></i></div><button type="button" data-action="repair" class="dl-repair" data-ui="repair"><span data-ui="repairLabel">МАШИНА В ПОРЯДКЕ</span><span data-ui="repairCost">✓</span></button></div>
      </aside>
      <footer class="dl-garage-footer"><div class="dl-key-legend"><span><kbd>WASD</kbd> езда</span><span><kbd>МЫШЬ</kbd> прицел</span><span><kbd>SHIFT</kbd> нитро</span><span><kbd>SPACE</kbd> ручник</span><span><kbd>TAB</kbd> карта</span><span><kbd>ESC</kbd> пауза</span></div><div class="dl-world-id">DUSTLINE // СВОБОДНАЯ ДОРОГА <span data-ui="seed" hidden></span></div></footer>
    </section>
    <section class="dl-hud" data-ui="hud" hidden aria-label="Показатели заезда">
      <div class="dl-run-stats"><div><span>ЗАЕЗД</span><strong data-ui="time">00:00</strong></div><div><span>ДОБЫЧА</span><strong class="dl-earned"><span data-ui="earned">0</span><small> $</small></strong></div></div>
      <div class="dl-contract" data-ui="objectiveCard" hidden><div class="dl-contract-title"><span>КОНТРАКТ</span><b data-ui="objectiveReward">+0 $</b></div><p data-ui="objectiveText"></p><div class="dl-contract-progress"><span>ПРОГРЕСС</span><b data-ui="objectiveProgress">0 / 1</b></div><div class="dl-contract-track"><i data-ui="objectiveFill"></i></div></div>
      <div class="dl-wanted"><div class="dl-stars" data-ui="stars" aria-label="Уровень розыска">${Array.from({ length: 5 }, (_, i) => `<span data-star="${i + 1}">★</span>`).join('')}</div><div class="dl-pursuit-label" data-ui="pursuitLabel">СВОБОДНАЯ ДОРОГА</div><div class="dl-escape-track" data-ui="escapeTrack"><i data-ui="escapeFill"></i></div></div>
      <div class="dl-garage-prompt"><span data-ui="nearGarage">ГАРАЖ</span><button type="button" data-action="garage" data-ui="enterGarage" hidden>В ГАРАЖ <span>G ↗</span></button></div>
      <div class="dl-notice" data-ui="notice" role="status" hidden></div>
      <div class="dl-pickup-notice" data-ui="pickupNotice" role="status" hidden></div>
      <div class="dl-fire-warning" data-ui="fireWarning" role="alert" hidden><strong data-ui="fireTitle"></strong><span>Ищи красный ящик с крестом и надписью «РЕМОНТ +25».</span></div>
      <div class="dl-reticle" data-ui="reticle" aria-hidden="true" hidden></div>
      <div class="dl-tutorial" data-ui="tutorial" hidden><span><kbd>WASD</kbd> езда</span><span><kbd>МЫШЬ + ЛКМ</kbd> прицел и огонь</span><span><kbd>SHIFT</kbd> нитро</span><span><kbd>SPACE</kbd> ручник</span><span><kbd>1 / 2</kbd> оружие</span><span><kbd>ESC</kbd> пауза</span></div>
      <button type="button" class="dl-test-toggle" data-action="testpanel" data-ui="testToggle" aria-label="Настройки заезда" title="Настройки заезда" aria-expanded="false" aria-controls="dl-driving-panel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/><path d="M7 3v6M17 9v6M9 15v6"/></svg></button><aside class="dl-driving-panel" id="dl-driving-panel" data-ui="drivingPanel" hidden><button class="dl-test-close" type="button" data-action="testpanel" aria-label="Закрыть настройки заезда">×</button>${drivingControls('live')}<div class="dl-live-settings-note">Заезд продолжается. Нажми Esc, чтобы поставить игру на паузу.</div></aside>
      <div class="dl-vehicle-hud"><div class="dl-speed"><strong data-ui="speed">000</strong><div><b>КМ/Ч</b><span data-ui="biome">ГОРОД</span></div></div><div class="dl-nitro-label"><span>НИТРО</span><b data-ui="nitroValue">100%</b></div><div class="dl-nitro-track"><i data-ui="nitroFill"></i></div><div class="dl-health"><div data-component="hull"><span>КУЗОВ</span><i><em data-ui="hullFill"></em></i><b data-ui="hullValue">100</b></div><div data-component="engine"><span>МОТОР</span><i><em data-ui="engineFill"></em></i><b data-ui="engineValue">100</b></div><div data-component="tires"><span>ШИНЫ</span><i><em data-ui="tiresFill"></em></i><b data-ui="tiresValue">100</b></div></div></div>
      <div class="dl-combat-hud"><div class="dl-weapon-keys" aria-hidden="true"><span>1</span><span>2</span><span>ПКМ</span></div><div class="dl-weapon-switch"><button type="button" data-action="weapon" data-weapon="turret" aria-pressed="true" title="Турель — 1" aria-label="Выбрать турель"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 22h22v5H5zM10 13h12l4 7H7zM15 8h5v7h-5zM19 9h12v4H19z"/></svg><span class="dl-weapon-name">Турель</span><small>∞</small></button><button type="button" data-action="weapon" data-weapon="rocket" aria-pressed="false" title="Ракеты — 2" aria-label="Выбрать ракеты"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M22 3l7 7-13 13-7-7zM22 3l8-1-1 8zM8 17l-5 1-2 7 8-3zM15 24l-1 7 7-3 1-5zM5 25l-4 6 6-3z"/></svg><span class="dl-weapon-name">Ракеты</span><small data-rocket-count>0</small></button></div><div class="dl-turret-status"><div class="dl-heat-track"><i data-ui="heatFill"></i></div><div class="dl-heat-caption"><span data-ui="heatLabel">НАГРЕВ</span><b data-ui="heatValue">0%</b></div></div><div class="dl-rocket-status" data-ui="rocketStatus" hidden>РАКЕТА ГОТОВА</div><div class="dl-target-line"><span>ЦЕЛЬ</span><b data-ui="targetName"></b></div><div class="dl-ammo" title="Гранатомёт — ПКМ"><div><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M8 1h8v4H8zM7 5h10l4 7v11l-5 4H8l-5-4V12zM16 2h5v8h-3V5h-2z"/></svg><span>ГРАНАТОМЁТ</span></div><b data-ui="ammo">12</b></div></div>
      <button type="button" class="dl-radar" data-action="map" title="Карта — Tab" aria-label="Открыть полную карту"><span class="dl-radar-title"><span>РАДАР</span><b>N ↑</b></span><canvas class="dl-minimap-canvas" data-ui="minimap" width="180" height="180" aria-label="Мини-карта дорог, гаражей и преследователей"></canvas><span class="dl-radar-legend"><span><i class="dl-dot-police"></i>полиция</span><span><i class="dl-dot-garage"></i>гараж</span></span></button>
      <button class="dl-pause-button" type="button" data-ui="pauseHint" aria-label="Нажмите Escape для паузы" tabindex="-1">Ⅱ <span>ESC</span></button>
    </section>
    <div class="dl-modal-backdrop" data-ui="pause" hidden><section class="dl-modal dl-pause-modal" aria-labelledby="dl-pause-title"><span class="dl-eyebrow">ВРЕМЯ ПЕРЕВЕСТИ ДУХ</span><h2 id="dl-pause-title">ПАУЗА.</h2><p>Твоя дорога подождёт.</p><div class="dl-pause-controls"><div><kbd>W A S D</kbd><span>Газ, тормоз и руль</span></div><div><kbd>МЫШЬ</kbd><span>Прицел оружия</span></div><div><kbd>ЛКМ / ПКМ</kbd><span>Оружие / гранатомёт</span></div><div><kbd>SHIFT</kbd><span>Нитро</span></div><div><kbd>SPACE</kbd><span>Ручник</span></div><div><kbd>G</kbd><span>Въехать в гараж без хвоста</span></div></div><div class="dl-pause-settings">${drivingControls('pause')}${pickupLegend()}</div><button class="dl-primary" type="button" data-action="resume">ПРОДОЛЖИТЬ <span>↗</span></button><button class="dl-secondary dl-pause-garage" type="button" data-ui="pauseGarage" data-action="garage" disabled>ДОБЕРИСЬ ДО ГАРАЖА НА МИНИ-КАРТЕ</button><button class="dl-secondary" type="button" data-action="restart">НОВЫЙ ЗАЕЗД</button></section></div>
    <div class="dl-modal-backdrop" data-ui="gameover" hidden><section class="dl-modal dl-results" aria-labelledby="dl-result-title"><span class="dl-eyebrow">ПОГОНЯ ЗАКОНЧЕНА</span><h2 id="dl-result-title">ДОЕЗДИЛИСЬ.</h2><p>Каждый след на кузове — своя история.</p><div class="dl-result-stats"><div><span>ВРЕМЯ</span><strong data-ui="resultTime">00:00</strong></div><div><span>РЕКОРД</span><strong data-ui="resultBest">00:00</strong></div><div><span>ЗАРАБОТАНО</span><strong class="dl-acid"><span data-ui="resultEarned">0</span><small> $</small></strong></div><div><span>ВЫВЕДЕНО ИЗ СТРОЯ</span><strong data-ui="resultKills">0</strong></div></div><p class="dl-result-note">После аварии сохраняется половина добычи.</p><button class="dl-primary" type="button" data-action="restart">ЕЩЁ ОДИН ЗАЕЗД <span>↗</span></button><button class="dl-secondary" type="button" data-action="garage">В ГАРАЖ</button></section></div>
    <div class="dl-modal-backdrop" data-ui="garageSettings" hidden><section class="dl-modal dl-garage-settings-modal" role="dialog" aria-modal="true" aria-labelledby="dl-garage-settings-title"><button class="dl-test-close" type="button" data-action="settingmodal" aria-label="Закрыть настройки">×</button><h2 id="dl-garage-settings-title">НАСТРОЙКИ</h2>${drivingControls("garage")}<button class="dl-primary" type="button" data-action="settingmodal">ГОТОВО <span>↗</span></button></section></div>
    <div class="dl-mobile-warning">Для полного контроля используй клавиатуру и мышь.</div>
  `;
  container.append(root);
  const els = Object.fromEntries(Array.from(root.querySelectorAll<HTMLElement>('[data-ui]')).map(el => [el.dataset.ui!, el])) as Record<string, HTMLElement>;
  const carTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action="select"]'));
  const swatches = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action="paint"]'));
  const upgrades = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action="upgrade"]'));
  const stars = Array.from(root.querySelectorAll<HTMLElement>('[data-star]'));
  const sound = root.querySelector<HTMLButtonElement>('.dl-sound')!;
  const garageTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.dl-garage-nav [data-action="tab"]'));
  const handlingSelects = Array.from(root.querySelectorAll<HTMLSelectElement>('[data-setting="handling"]'));
  const trafficSelects = Array.from(root.querySelectorAll<HTMLSelectElement>('[data-setting="traffic"]'));
  const handlingNotes = Array.from(root.querySelectorAll<HTMLElement>('[data-handling-description]'));
  const pursuitToggles = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-pursuit-toggle]'));
  const weaponButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action="weapon"]'));
  const rocketCounts = Array.from(root.querySelectorAll<HTMLElement>('[data-rocket-count]'));
  const musicToggles = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-music-toggle]'));
  const healthDetails = Array.from(root.querySelectorAll<HTMLElement>('[data-health-detail]'));
  const objectiveSummaries = Array.from(root.querySelectorAll<HTMLElement>('[data-objective-summary]'));
  const componentRows = Array.from(root.querySelectorAll<HTMLElement>('[data-component]'));
  const assistSelects = Array.from(root.querySelectorAll<HTMLSelectElement>('[data-setting="assist"]'));
  const wantedSelects = Array.from(root.querySelectorAll<HTMLSelectElement>('[data-setting="wanted"]'));
  const cheatInputs = Array.from(root.querySelectorAll<HTMLInputElement>('[data-setting="cheat"]'));
  const sandboxOptions = Array.from(root.querySelectorAll<HTMLFieldSetElement>('[data-sandbox-options]'));
  const sandboxToggles = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-sandbox-toggle]'));
  const volumeInputs = Array.from(root.querySelectorAll<HTMLInputElement>('[data-setting="volume"]'));
  const volumeOutputs = Array.from(root.querySelectorAll<HTMLOutputElement>('[data-volume-label]'));
  const challengeEls = Array.from(root.querySelectorAll<HTMLElement>('[data-challenge]'));
  let selectedId = CARS[0].id;
  let garageSignature = '';
  let lastMode = '';
  let lastMinimap = -Infinity;
  let disposed = false;
  const textValues = new Map<string, string>();
  const text = (key: string, value: string | number) => {
    const str = String(value);
    if (textValues.get(key) !== str) { els[key].textContent = str; textValues.set(key, str); }
  };
  const bar = (key: string, value: number, danger = false) => {
    const width = `${Math.round(percent(value))}%`;
    if (els[key].style.width !== width) els[key].style.width = width;
    els[key].classList.toggle('is-critical', danger && value < 28);
  };
  const changeGarageTab = (tab: GarageTab) => {
    root.dataset.garageTab = tab; garageSignature = '';
    text('garageTitle', tabLabels[tab]); text('garageSubtitle', tabSubtitles[tab]);
    for (const button of garageTabs) { const active = button.dataset.tab === tab; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); }
    actions.garageTab(tab);
  };
  const toggleGarageSettings = () => {
    els.garageSettings.hidden = !els.garageSettings.hidden;
    const focus = els.garageSettings.hidden ? root.querySelector<HTMLButtonElement>('.dl-garage-settings') : els.garageSettings.querySelector<HTMLButtonElement>('[data-action="settingmodal"]');
    focus?.focus();
  };
  const focusGame = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const gameCanvas = document.querySelector<HTMLCanvasElement>('#game');
    if (gameCanvas) { gameCanvas.tabIndex = -1; gameCanvas.focus({ preventScroll: true }); }
  };
  const click = (event: MouseEvent) => {
    if (event.target === els.garageSettings) { toggleGarageSettings(); return; }
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action]') : null;
    if (!target || target.disabled) return;
    switch (target.dataset.action) {
      case 'start': actions.start(); focusGame(); break;
      case 'choose': actions.selectCar(selectedId); changeGarageTab('garage'); break;
      case 'cycle': { const index = Math.max(0, CARS.findIndex(car => car.id === selectedId)); selectedId = CARS[(index + Number(target.dataset.step) + CARS.length) % CARS.length].id; actions.selectCar(selectedId); break; }
      case 'select': actions.selectCar(target.dataset.id!); break;
      case 'buy': if (!CHALLENGES.some(challenge => challenge.carId === selectedId)) actions.buyCar(selectedId); break;
      case 'buyTurret': actions.buyTurret(); break;
      case 'toggleTurret': actions.toggleTurret(); break;
      case 'upgradeTurret': actions.upgradeTurret(); break;
      case 'sandbox': actions.toggleSandbox(); break;
      case 'settingmodal': toggleGarageSettings(); break;
      case 'paint': actions.paint(target.dataset.color!); break;
      case 'upgrade': actions.upgrade(target.dataset.key as UpgradeKey); break;
      case 'repair': actions.repair(); break;
      case 'resume': actions.resume(); focusGame(); break;
      case 'garage': actions.garage(); break;
      case 'restart': actions.restart(); focusGame(); break;
      case 'music': actions.toggleMusic(); break;
      case 'map': actions.openMap(); break;
      case 'pursuit': actions.togglePursuit(); break;
      case 'weapon': actions.selectWeapon(target.dataset.weapon as WeaponKind); if (!target.closest('[role="dialog"]')) focusGame(); break;
      case 'testpanel':
        els.drivingPanel.hidden = !els.drivingPanel.hidden;
        els.testToggle.setAttribute('aria-expanded', String(!els.drivingPanel.hidden));
        if (els.drivingPanel.hidden) focusGame();
        else els.drivingPanel.querySelector<HTMLSelectElement>('select')?.focus();
        break;
      case 'tab': changeGarageTab(target.dataset.tab as GarageTab); break;
    }
  };
  root.addEventListener('click', click);
  const change = (event: Event) => {
    const select = event.target;
    if (select instanceof HTMLSelectElement && select.dataset.setting === 'assist') actions.setAimAssist(select.dataset.weapon as WeaponKind, select.value as AimAssist);
    if (select instanceof HTMLSelectElement && select.dataset.setting === 'wanted') actions.setWanted(Number(select.value));
    if (select instanceof HTMLInputElement && select.dataset.setting === 'cheat') actions.setCheat(select.dataset.cheat as CheatKey, select.checked);
    if (select instanceof HTMLInputElement && select.dataset.setting === 'volume') actions.setVolume(select.dataset.channel as AudioChannel, Number(select.value) / 100);
    if (select instanceof HTMLSelectElement && select.dataset.setting === 'handling') { actions.setHandling(select.value as HandlingProfileId); select.blur(); }
    if (select instanceof HTMLSelectElement && select.dataset.setting === 'traffic') { actions.setTrafficSide(select.value as 'right' | 'left'); select.blur(); }
  };
  const volumeInput = (event: Event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.dataset.setting === 'volume') actions.setVolume(input.dataset.channel as AudioChannel, Number(input.value) / 100);
  };
  const selectKey = (event: KeyboardEvent) => {
    if (!els.garageSettings.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); toggleGarageSettings(); return; }
    if (!els.drivingPanel.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); els.drivingPanel.hidden = true; els.testToggle.setAttribute('aria-expanded', 'false'); focusGame(); return; }
    if (!els.garageSettings.hidden && event.key === 'Tab') {
      const focusable = Array.from(els.garageSettings.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary')).filter(el => el.offsetParent !== null);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      event.stopPropagation();
    } if ((event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement)) event.stopPropagation(); if (event.target instanceof HTMLButtonElement && event.target.dataset.action === 'map' && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); actions.openMap(); } };
  root.addEventListener('change', change);
  root.addEventListener('input', volumeInput);
  root.addEventListener('keydown', selectKey);
  const reticle = els.reticle;
  reticle.style.transform = `translate3d(${window.innerWidth / 2 - 9}px,${window.innerHeight / 2 - 9}px,0)`;
  const pointerMove = (event: PointerEvent) => {
    reticle.style.transform = `translate3d(${event.clientX - 9}px,${event.clientY - 9}px,0)`;
  };
  window.addEventListener('pointermove', pointerMove, { passive: true });
  const minimap = els.minimap as HTMLCanvasElement;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  minimap.width = Math.round(180 * dpr);
  minimap.height = Math.round(180 * dpr);
  const ctx = minimap.getContext('2d');

  function render(state: GameState, save: SaveData) {
    if (disposed) return;
    selectedId = save.selected;
    root.dataset.weapon = state.weapon || 'turret';
    root.dataset.sandbox = String(state.sandbox);
    text('compactCredits', money(save.credits));
    for (const select of assistSelects) select.value = select.dataset.weapon === 'turret' ? state.turretAssist : state.rocketAssist;
    for (const select of wantedSelects) select.value = String(state.wantedOverride);
    for (const input of cheatInputs) input.checked = state.cheats[input.dataset.cheat as CheatKey];
    for (const options of sandboxOptions) options.disabled = !state.sandbox;
    for (const toggle of sandboxToggles) { toggle.textContent = state.sandbox ? 'ПЕСОЧНИЦА ВКЛЮЧЕНА' : 'ВКЛЮЧИТЬ ПЕСОЧНИЦУ'; toggle.setAttribute('aria-pressed', String(state.sandbox)); }
    for (const input of volumeInputs) if (document.activeElement !== input) input.value = String(Math.round(save.volumes[input.dataset.channel as AudioChannel] * 100));
    for (const output of volumeOutputs) output.value = `${Math.round(save.volumes[output.dataset.volumeLabel as AudioChannel] * 100)}%`;
    for (const card of challengeEls) {
      const challenge = CHALLENGES.find(item => item.id === card.dataset.challenge)!;
      const complete = save.completedChallenges.includes(challenge.id) || save.owned.includes(challenge.carId);
      const value = Math.min(challenge.target, challengeProgress(save, challenge.id));
      const progress = card.querySelector<HTMLProgressElement>('progress')!;
      progress.value = complete ? challenge.target : value;
      card.classList.toggle('is-complete', complete);
      card.querySelector<HTMLElement>('[data-challenge-progress]')!.textContent = complete ? 'ВЫПОЛНЕНО · МАШИНА В ГАРАЖЕ' : `${Math.floor(value).toLocaleString('ru-RU')} / ${challenge.target.toLocaleString('ru-RU')}`;
    }
    for (const select of handlingSelects) if (select.value !== state.handlingProfile) select.value = state.handlingProfile || 'arcade';
    for (const select of trafficSelects) if (select.value !== state.trafficSide) select.value = state.trafficSide || 'right';
    const handlingDescription = handlingDescriptions[state.handlingProfile || 'arcade'];
    for (const note of handlingNotes) if (note.textContent !== handlingDescription) note.textContent = handlingDescription;
    for (const button of pursuitToggles) {
      const label = state.pursuitEnabled ? 'ПОЛИЦИЯ ВКЛЮЧЕНА' : 'ПОЛИЦИЯ ВЫКЛЮЧЕНА';
      if (button.textContent !== label) button.textContent = label;
      button.classList.toggle('is-off', !state.pursuitEnabled); button.setAttribute('aria-pressed', String(state.pursuitEnabled));
    }
    for (const button of weaponButtons) { button.disabled = button.dataset.weapon === 'turret' && !(state.mode === 'garage' ? turretAvailable(save) : state.turretEquipped); button.title = button.dataset.weapon === 'turret' && button.disabled ? 'Купи и установи турель в гараже → Тюнинг' : button.dataset.weapon === 'turret' ? 'Турель — 1' : 'Ракеты — 2'; const selected = button.dataset.weapon === state.weapon; button.classList.toggle('is-active', selected); button.setAttribute('aria-pressed', String(selected)); }
    const rocketCount = state.sandbox && state.cheats.unlimitedAmmo ? '∞' : String(state.rockets ?? 0);
    for (const count of rocketCounts) if (count.textContent !== rocketCount) count.textContent = rocketCount;
    text('targetName', state.targetName || '');
    els.targetName.parentElement!.hidden = !state.targetName;
    els.rocketStatus.hidden = state.weapon !== 'rocket';
    const hasRockets = state.rockets > 0 || state.sandbox && state.cheats.unlimitedAmmo;
    text('rocketStatus', !hasRockets ? 'НЕТ РАКЕТ' : !state.targetName ? 'НЕТ ЦЕЛИ' : state.rocketReady ? 'РАКЕТА ГОТОВА' : 'ПОДГОТОВКА…');
    els.rocketStatus.classList.toggle('is-ready', state.rocketReady && hasRockets);
    els.pickupNotice.hidden = !(state.mode === 'playing' && (state.pickupNoticeTime || 0) > 0 && state.pickupNotice);
    if (!els.pickupNotice.hidden) text('pickupNotice', state.pickupNotice!);
    const engineBurning = state.mode === 'playing' && (state.burnSeconds || 0) > 0;
    els.tutorial.hidden = !(state.mode === 'playing' && state.tutorialTime > 0);
    els.fireWarning.hidden = !engineBurning;
    if (engineBurning) text('fireTitle', `МОТОР ГОРИТ · ВЗРЫВ ЧЕРЕЗ ${Math.ceil(state.burnSeconds!)} С`);
    if (lastMode !== state.mode) {
      root.dataset.mode = state.mode;
      els.garage.hidden = state.mode !== 'garage';
      els.hud.hidden = state.mode === 'garage';
      els.pause.hidden = state.mode !== 'paused';
      els.gameover.hidden = state.mode !== 'gameover';
      reticle.hidden = state.mode !== 'playing';
      if (state.mode !== 'garage') els.garageSettings.hidden = true;
      lastMode = state.mode;
    }
    text('musicLabel', save.music ? 'МУЗЫКА ВКЛ' : 'МУЗЫКА ВЫКЛ');
    for (const toggle of musicToggles) { const label = save.music ? 'МУЗЫКА ВКЛЮЧЕНА' : 'МУЗЫКА ВЫКЛЮЧЕНА'; if (toggle.textContent !== label) toggle.textContent = label; toggle.setAttribute('aria-pressed', String(save.music)); }
    sound.dataset.on = String(save.music);
    sound.setAttribute('aria-label', save.music ? 'Выключить музыку' : 'Включить музыку');
    const hull = percent(state.health / Math.max(1, state.maxHealth) * 100);
    const readings = { hull, engine: state.engine, tires: state.tires };
    for (const detail of healthDetails) { const value = `${Math.round(readings[detail.dataset.healthDetail as keyof typeof readings])}%`; if (detail.textContent !== value) detail.textContent = value; }
    for (const row of componentRows) row.classList.toggle('is-problem', row.dataset.component !== 'hull' && readings[row.dataset.component as keyof typeof readings] < 65);
    const mission = state.objective ? `${state.objective} · ${Math.floor(state.objectiveProgress || 0)} / ${state.objectiveTarget || 0} · +${money(state.objectiveReward || 0)} $` : 'Контракт появится во время заезда.';
    for (const summary of objectiveSummaries) if (summary.textContent !== mission) summary.textContent = mission;
    if (state.mode === 'garage') {
      const signature = `${JSON.stringify(save)}:${Math.round(hull)}:${Math.round(state.engine)}:${Math.round(state.tires)}`;
      if (signature !== garageSignature) {
        garageSignature = signature;
        const spec = CARS.find(car => car.id === save.selected) || CARS[0];
        const index = CARS.indexOf(spec);
        const owned = save.owned.includes(spec.id);
        const levels = carUpgrades(save, spec.id);
        const color = save.colors[spec.id] || spec.color;
        text('carIndex', `0${index + 1}`);
        text('carClass', ({ comet: 'ГОРОД / ЛЁГКИЙ', rally: 'РАЛЛИ / СРЕДНИЙ', brute: 'ПИКАП / ТЯЖЁЛЫЙ', kestrel: 'СПОРТ / ЛЁГКИЙ', sandfox: 'БАГГИ / БЕЗДОРОЖЬЕ', cobra: 'СУПЕРКАР / СКОРОСТЬ', bastion: 'БРОНЕВИК / ТЯЖЁЛЫЙ' } as Record<string, string>)[spec.id] || 'ОСОБАЯ МАШИНА');
        const challenge = CHALLENGES.find(item => item.carId === spec.id);
        text('ownedLabel', owned ? 'В ТВОЁМ ГАРАЖЕ' : challenge ? `НАГРАДА · ${challenge.difficulty}` : 'ДОСТУПЕН ДЛЯ ПОКУПКИ');
        text('carName', spec.name);
        text('menuCarName', spec.name);
        text('carSubtitle', spec.subtitle);
        const upgradedSpeed = Math.round(spec.speed * (1 + levels.engine * 0.085) * 3.6);
        const upgradedHandling = Math.round((1 + levels.handling * .1) * 100);
        const upgradedArmor = spec.armor + levels.armor * 30;
        text('speedStat', `${upgradedSpeed} КМ/Ч`);
        text('handlingStat', `${upgradedHandling}% ОТКЛИК`);
        text('armorStat', upgradedArmor);
        bar('speedBar', upgradedSpeed / 170 * 100);
        bar('handlingBar', upgradedHandling / 130 * 100);
        bar('armorBar', upgradedArmor / 290 * 100);
        text('credits', money(save.credits));
        text('garageBest', clock(save.best));
        text('launchLabel', owned ? root.dataset.garageTab === 'cars' ? 'ВЫБРАТЬ' : 'ПОЛНЫЙ ГАЗ!' : challenge ? 'ВЫПОЛНИ ЗАДАНИЕ' : `КУПИТЬ / ${money(spec.price)} $`);
        els.launch.dataset.action = owned ? root.dataset.garageTab === 'cars' ? 'choose' : 'start' : 'buy';
        (els.launch as HTMLButtonElement).disabled = !owned && (!!challenge || save.credits < spec.price);
        text('launchNote', owned ? 'Погоня начинается с первого поворота.' : challenge ? `${challenge.description} · Награда бесплатно.` : save.credits < spec.price ? `Ещё ${money(spec.price - save.credits)} $ — и она твоя.` : 'Твой следующий способ исчезнуть.');
        for (const tab of carTabs) {
          const active = tab.dataset.id === spec.id;
          tab.classList.toggle('is-active', active);
          tab.setAttribute('aria-pressed', String(active));
          const lock = tab.querySelector<HTMLElement>('i')!;
          lock.textContent = save.owned.includes(tab.dataset.id!) ? '' : '◇';
        }
        for (const swatch of swatches) {
          const active = swatch.dataset.color === color;
          swatch.classList.toggle('is-active', active);
          swatch.setAttribute('aria-pressed', String(active));
          swatch.disabled = !owned;
        }
        text('paintLabel', (paintNames[color] || 'СВОЙ ЦВЕТ').toUpperCase());
        for (const button of upgrades) {
          const key = button.dataset.key as UpgradeKey;
          const level = levels[key];
          const cost = upgradeCost(level, key);
          button.disabled = !owned || level >= 3 || save.credits < cost;
          button.setAttribute('aria-label', `${UPGRADE_NAMES[key]}, уровень ${level} из 3. ${upgradeEffect(spec, key, level)}${level < 3 ? ` Улучшить за ${cost} кредитов.` : ' Максимум.'}`);
          button.querySelector<HTMLElement>('[data-price]')!.textContent = level >= 3 ? 'МАКС.' : `${money(cost)} $`;
          button.querySelector<HTMLElement>('[data-level-label]')!.textContent = `УРОВЕНЬ ${level} / 3`;
          button.querySelectorAll('[data-level] i').forEach((pip, i) => pip.classList.toggle('is-filled', i < level));
          button.querySelector<HTMLElement>('[data-upgrade-effect]')!.textContent = upgradeEffect(spec, key, level);
          button.querySelector<HTMLElement>('.dl-upgrade-add')!.textContent = level >= 3 ? '✓' : '+';
        }
        const installed = turretAvailable(save, spec.id), cooling = save.turretCooling;
        text('turretOwnership', save.turretOwned ? 'Турель куплена · доступна для всех машин' : 'Турель не куплена · начни заезд без неё');
        els.turretBuy.hidden = save.turretOwned;
        (els.turretBuy as HTMLButtonElement).disabled = save.credits < TURRET_PRICE;
        els.turretInstall.hidden = !save.turretOwned;
        (els.turretInstall as HTMLButtonElement).disabled = !owned;
        els.turretInstall.setAttribute('aria-pressed', String(installed));
        text('turretInstall', !owned ? 'СНАЧАЛА ОТКРОЙ МАШИНУ' : installed ? 'СНЯТЬ С ЭТОЙ МАШИНЫ' : 'УСТАНОВИТЬ НА ЭТУ МАШИНУ');
        (els.turretUpgrade as HTMLButtonElement).disabled = !save.turretOwned || cooling >= 3 || save.credits < turretCoolingCost(cooling);
        text('turretUpgradePrice', cooling >= 3 ? 'МАКС.' : `${money(turretCoolingCost(cooling))} $`);
        text('turretUpgradeEffect', `УРОВЕНЬ ${cooling} / 3 · скорость охлаждения +${cooling * 15}%${cooling < 3 ? ` → +${(cooling + 1) * 15}%` : ''}`);
        const needsRepair = owned && (hull < 99.5 || state.engine < 99.5 || state.tires < 99.5);
        const condition = Math.round(Math.min(hull, state.engine, state.tires));
        text('condition', `${condition}%`);
        bar('garageHealth', condition, true);
        (els.repair as HTMLButtonElement).disabled = !needsRepair || save.credits < 150;
        els.repair.dataset.condition = needsRepair ? 'damaged' : 'ready';
        text('repairLabel', !owned ? 'КУПИ МАШИНУ ДЛЯ ТЮНИНГА' : needsRepair ? 'ПОЛНЫЙ РЕМОНТ' : 'МАШИНА В ПОРЯДКЕ');
        text('repairCost', needsRepair ? '150 $' : '✓');
        text('seed', ` / #${state.seed.toString(16).toUpperCase().slice(-6)}`);
      }
    }
    text('time', clock(state.seconds));
    text('earned', money(state.earned));
    const hasObjective = Boolean(state.objective) && state.mode === 'playing';
    els.objectiveCard.hidden = !hasObjective;
    if (hasObjective) {
      const target = Math.max(1, Math.ceil(state.objectiveTarget || 1));
      const progress = Math.max(0, state.objectiveProgress || 0);
      text('objectiveReward', `+${money(state.objectiveReward || 0)} $`);
      text('objectiveText', state.objective!);
      text('objectiveProgress', `${Math.min(target, Math.floor(progress))} / ${target}`);
      bar('objectiveFill', progress / target * 100);
    }
    text('speed', Math.round(Math.max(0, state.speed)).toString().padStart(3, '0'));
    text('biome', biomeNames[state.biome]);
    const wanted = Math.min(5, Math.max(0, Math.ceil(state.wanted)));
    for (let i = 0; i < stars.length; i++) stars[i].classList.toggle('is-active', i < wanted);
    els.stars.parentElement!.classList.toggle('is-hunted', wanted > 0);
    els.stars.setAttribute('aria-label', `Розыск: ${wanted} из 5`);
    text('pursuitLabel', state.sandbox ? `ПЕСОЧНИЦА · ${wanted} ★` : !state.pursuitEnabled ? 'СВОБОДНЫЙ ЗАЕЗД · БЕЗ ПОЛИЦИИ' : wanted === 0 ? 'СВОБОДНАЯ ДОРОГА' : state.escape > 0 ? 'ТЕРЯЕМ ХВОСТ' : `ПРЕСЛЕДОВАНИЕ / ${wanted}`);
    els.escapeTrack.style.opacity = wanted > 0 && state.escape > 0 ? '1' : '0';
    bar('escapeFill', state.escape);
    for (const [prefix, value] of [['nitro', state.nitro], ['hull', hull], ['engine', state.engine], ['tires', state.tires], ['heat', state.heat]] as const) {
      bar(`${prefix}Fill`, value, prefix !== 'nitro' && prefix !== 'heat');
      text(`${prefix}Value`, `${Math.round(percent(value))}%`);
    }
    els.heatFill.classList.toggle('is-hot', state.heat > 80);
    text('heatLabel', !state.turretEquipped ? 'ТУРЕЛЬ НЕ УСТАНОВЛЕНА' : state.sandbox && state.cheats.noOverheat ? 'БЕЗ ПЕРЕГРЕВА' : state.heat >= 98 ? 'ПЕРЕГРЕВ' : 'НАГРЕВ');
    text('ammo', state.sandbox && state.cheats.unlimitedAmmo ? '∞' : Math.max(0, state.ammo));
    text('nearGarage', state.wanted > 0 ? 'СНАЧАЛА СБРОСЬ ХВОСТ' : `ГАРАЖ / ${Math.round(state.garageDistance)} М`);
    els.enterGarage.hidden = !(state.canGarage && state.garageDistance < 13 && state.mode === 'playing');
    const canEnterGarage = state.canGarage && state.garageDistance < 13;
    (els.pauseGarage as HTMLButtonElement).disabled = !canEnterGarage;
    text('pauseGarage', canEnterGarage ? 'ВЪЕХАТЬ В ГАРАЖ ↗' : state.wanted > 0 ? 'ДЛЯ ГАРАЖА СНАЧАЛА СБРОСЬ ХВОСТ' : !state.canGarage && state.garageDistance < 13 ? 'РАЗОГРЕЙ МОТОР · ГАРАЖ СКОРО ОТКРОЕТСЯ' : `ДО ГАРАЖА ${Math.round(state.garageDistance)} М · НАЙДИ G НА МИНИ-КАРТЕ`);
    const showMessage = state.messageTime > 0 && Boolean(state.message) && state.mode === 'playing' && !engineBurning;
    els.notice.hidden = !showMessage;
    if (showMessage) text('notice', state.message);
    const garageMessage = state.messageTime > 0 && Boolean(state.message) && state.mode === 'garage';
    els.garageNotice.hidden = !garageMessage;
    if (garageMessage) text('garageNotice', state.message);
    if (state.mode === 'gameover') {
      text('resultTime', clock(state.seconds));
      text('resultBest', clock(Math.max(save.best, state.seconds)));
      text('resultEarned', money(Math.floor(state.earned * 0.5)));
      text('resultKills', state.kills);
    }
  }

  function drawMinimap(map: MapData, x: number, z: number, angle: number, markers: RadarMarker[]) {
    if (!ctx || disposed || lastMode === 'garage') return;
    const now = performance.now();
    if (now - lastMinimap < 95) return;
    lastMinimap = now;
    const size = 180;
    const range = 100;
    const scale = size / (range * 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const terrain = { city: '#344039', desert: '#615640', fields: '#3e503c' };
    const step = 5;
    const px = step * scale;
    for (let dz = -range; dz < range; dz += step) {
      for (let dx = -range; dx < range; dx += step) {
        const wx = x + dx + step / 2;
        const wz = z + dz + step / 2;
        ctx.fillStyle = map.isRoad(wx, wz) ? '#85897c' : terrain[map.biomeAt(wx, wz)];
        ctx.fillRect((dx + range) * scale, (range - dz - step) * scale, px + 0.5, px + 0.5);
      }
    }
    ctx.strokeStyle = 'rgba(236,233,223,.06)';
    ctx.lineWidth = 1;
    for (let point = 0; point <= size; point += 45) {
      ctx.beginPath(); ctx.moveTo(point, 0); ctx.lineTo(point, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, point); ctx.lineTo(size, point); ctx.stroke();
    }
    const position = (wx: number, wz: number) => ({ x: size / 2 + (wx - x) * scale, y: size / 2 - (wz - z) * scale });
    for (const garage of map.garages) {
      const p = position(garage.x, garage.z);
      if (p.x < 7 || p.x > 173 || p.y < 7 || p.y > 173) continue;
      ctx.fillStyle = '#e6ef64'; ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
      ctx.fillStyle = '#141918'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('G', p.x, p.y + 0.5);
    }
    let nearestGarage: { x: number; z: number } | undefined;
    let nearestDistance = Infinity;
    for (const garage of map.garages) {
      const distance = (garage.x - x) ** 2 + (garage.z - z) ** 2;
      if (distance < nearestDistance) { nearestDistance = distance; nearestGarage = garage; }
    }
    if (nearestGarage) {
      const p = position(nearestGarage.x, nearestGarage.z);
      if (p.x < 7 || p.x > 173 || p.y < 7 || p.y > 173) {
        const dx = p.x - 90, dy = p.y - 90;
        const clamp = Math.min(80 / Math.max(.001, Math.abs(dx)), 80 / Math.max(.001, Math.abs(dy)));
        const edgeX = 90 + dx * clamp, edgeY = 90 + dy * clamp;
        const length = Math.hypot(dx, dy);
        ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(230,239,100,.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(90 + dx / length * 12, 90 + dy / length * 12); ctx.lineTo(edgeX, edgeY); ctx.stroke(); ctx.restore();
        ctx.fillStyle = '#182117'; ctx.fillRect(edgeX - 7, edgeY - 7, 14, 14);
        ctx.strokeStyle = '#e6ef64'; ctx.lineWidth = 1; ctx.strokeRect(edgeX - 7, edgeY - 7, 14, 14);
        ctx.fillStyle = '#e6ef64'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('G', edgeX, edgeY + .5);
      }
    }
    for (const marker of markers) {
      const p = position(marker.x, marker.z);
      if (p.x < 3 || p.x > 177 || p.y < 3 || p.y > 177) continue;
      ctx.fillStyle = marker.type === 'police' ? '#ff765d' : marker.type === 'helicopter' ? '#c39ceb' : marker.type === 'pickup' ? '#e6ef64' : '#d2d5cc';
      if (marker.type === 'helicopter' || marker.type === 'pickup') { const radius = marker.type === 'helicopter' ? 5 : 3; ctx.beginPath(); ctx.moveTo(p.x, p.y - radius); ctx.lineTo(p.x + radius, p.y); ctx.lineTo(p.x, p.y + radius); ctx.lineTo(p.x - radius, p.y); ctx.closePath(); ctx.fill(); }
      else { const side = marker.type === 'traffic' ? 3 : 5; ctx.fillRect(p.x - side / 2, p.y - side / 2, side, side); }
    }
    ctx.save(); ctx.translate(size / 2, size / 2); ctx.rotate(angle);
    ctx.fillStyle = '#e6ef64'; ctx.strokeStyle = '#141918'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }

  return { render, drawMinimap, dispose() { disposed = true; root.removeEventListener('click', click); root.removeEventListener('change', change); root.removeEventListener('input', volumeInput); root.removeEventListener('keydown', selectKey); window.removeEventListener('pointermove', pointerMove); root.remove(); } };
}
