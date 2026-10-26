// Состояние и действия над раскладками. Чистая логика без Electron — её вызывает панель управления через IPC.
const L = require('./layouts');
const P = require('./palette');

class LayoutState {
  constructor(cfg, onChange) {
    this.cfg = cfg;
    this.onChange = onChange;
    this.sim = { source: 'none', connected: false };
    this.gameFocused = true;       // окно iRacing на переднем плане (обновляет главный процесс)
    this.manual = null;            // { layoutId, key } — ручной выбор действует, пока не сменилась машина/сессия
    this.panelSelection = null;    // { layoutId, variation } — что редактируется в панели
  }

  get layouts() { return this.cfg.layouts; }
  layout(id) { return this.layouts.find((l) => l.id === id); }

  simKey() {
    const s = this.sim;
    return s.connected ? `${s.car}|${s.category}|${s.session}` : 'disconnected';
  }

  // Какая раскладка сейчас активна и почему
  resolve() {
    const ctx = { car: this.sim.car, category: this.sim.category, session: this.sim.session };
    if (this.manual && this.manual.key === this.simKey() && this.layout(this.manual.layoutId)) {
      return { layout: this.layout(this.manual.layoutId), reason: 'manual' };
    }
    this.manual = null;
    if (this.cfg.autoSwitch && this.sim.connected && this.sim.car) {
      const m = L.findMatchingLayout(this.layouts, ctx);
      if (m) return { layout: m.layout, reason: 'auto', score: m.score };
    }
    const chosen = this.layout(this.cfg.activeLayoutId)
      || this.layouts.find((l) => l.isDefault)
      || this.layouts[0];
    return { layout: chosen, reason: 'default' };
  }

  // Набор оверлеев, которые должны быть на экране сейчас
  desiredOverlays() {
    if (this.cfg.hiddenAll) return [];
    const editing = !this.cfg.locked;
    // В режиме редактирования показываем то, что выбрано в панели, — так можно расставить любой вариант
    if (editing && this.panelSelection && this.layout(this.panelSelection.layoutId)) {
      const l = this.layout(this.panelSelection.layoutId);
      return L.overlaysOf(l, this.panelSelection.variation).filter((o) => o.enabled && L.gameAllows(this.cfg.game, o.type));
    }
    const { layout } = this.resolve();
    const variation = L.activeVariation(layout, this.sim);
    // Не в режиме редактирования: прячем всё, пока игра не в фокусе (alt-tab, рабочий стол), если так включено
    if (!editing && this.cfg.onlyWhenFocused !== false && !this.gameFocused) return [];
    return L.overlaysOf(layout, variation).filter((o) => o.enabled && L.gameAllows(this.cfg.game, o.type) && (editing || this.visibleNow(o, variation)));
  }

  // Для диагностики: у каждого оверлея набора — на экране ли он и, если нет, почему
  overlayStatus() {
    const editing = !this.cfg.locked;
    const { layout, reason } = this.resolve();
    const variation = L.activeVariation(layout, this.sim);
    const shown = new Set(this.desiredOverlays().map((o) => o.id));
    const sim = this.sim.connected ? (this.sim.source === 'demo' ? 'демо' : (this.sim.inGarage ? 'в гараже' : this.sim.onTrack ? 'на трассе' : 'в меню или повторе')) : 'игры нет';
    const why = (o) => {
      if (!o.enabled) return 'выключен';
      if (!L.gameAllows(this.cfg.game, o.type)) return `недоступен в игре ${this.cfg.game}`;
      if (this.cfg.hiddenAll) return 'скрыты все оверлеи';
      if (!editing && this.cfg.onlyWhenFocused !== false && !this.gameFocused) return 'окно игры не в фокусе';
      if (!editing && !this.visibleNow(o, variation)) return `не подходит «Где показывать» (сейчас: ${sim})`;
      return shown.has(o.id) ? '' : 'в режиме редактирования показывается набор, выбранный в панели';
    };
    return {
      layout: layout?.name || '—', variation, reason, sim, editing,
      list: L.overlaysOf(layout, variation).map((o) => ({ id: o.id, type: o.type, enabled: o.enabled, shown: shown.has(o.id), why: shown.has(o.id) ? '' : why(o) })),
    };
  }

  // Показывать ли оверлей прямо сейчас (по галочкам «Где показывать»):
  //   «Без игры» — iRacing не запущен (демо-режим тоже считается «без игры»);
  //   «Боксы» — вы в гараже; «Трасса» — вы за рулём и машина на трассе (включая питлейн);
  //   меню, повтор и роль зрителя — только если для этого есть свой вариант раскладки «Споттинг».
  visibleNow(o, variation) {
    const v = o.visibility || {};
    if (!this.sim.connected || this.sim.source === 'demo') return !!v.disconnected;
    if (this.sim.inGarage) return !!v.inGarage;
    if (this.sim.onTrack) return v.onTrack !== false;
    return variation === 'spotting';
  }

  // Где сейчас лежит оверлей с этим id (для сохранения позиции после перетаскивания)
  findOverlay(id) {
    const sel = !this.cfg.locked && this.panelSelection ? this.panelSelection : null;
    const layout = sel ? this.layout(sel.layoutId) : this.resolve().layout;
    const variation = sel ? sel.variation : L.activeVariation(layout, this.sim);
    return L.overlaysOf(layout, variation).find((o) => o.id === id) || null;
  }

  overlayList(layoutId, variation) {
    const l = this.layout(layoutId);
    if (!l) return null;
    if (!variation || variation === 'base') return l.overlays;
    return l.variations?.[variation]?.enabled ? l.variations[variation].overlays : null;
  }

  snapshot() {
    const { save, ...cfg } = this.cfg;
    const r = this.resolve();
    return {
      cfg,
      sim: this.sim,
      active: { layoutId: r.layout?.id, reason: r.reason, score: r.score ?? null, variation: L.activeVariation(r.layout, this.sim) },
      panelSelection: this.panelSelection,
      types: L.OVERLAY_TYPES,
      columnCatalog: L.COLUMN_CATALOG,
      decimalCatalog: L.DECIMAL_COLUMNS,
      hfCatalog: L.HF_CATALOG,
      weatherCards: L.WEATHER_CARDS,
      dashSchema: L.DASH_SCHEMA,
      sectorsSchema: L.SECTORS_SCHEMA,
      lapsSchema: L.LAPS_SCHEMA,
      rejoinSchema: L.REJOIN_SCHEMA,
      fuelSchema: L.FUEL_SCHEMA,
      relSchema: L.REL_SCHEMA,
      trafficSchema: L.TRAFFIC_SCHEMA,
      pitlimitSchema: L.PITLIMIT_SCHEMA,
      srSchema: L.SR_SCHEMA,
      forecastSchema: L.FORECAST_SCHEMA,
      radarbarsSchema: L.RADARBARS_SCHEMA,
      paletteGroups: P.GROUPS,
      palettePresets: P.PRESETS,
      paletteDim: P.DIM,
      paletteNames: P.NAMES,
      paletteSel: P.SEL,
      paletteLive: Object.fromEntries(Object.keys(L.OVERLAY_TYPES).map((t) => [t, P.liveVars(this.cfg.palette, t)])),
      paletteVars: Object.fromEntries(Object.keys(L.OVERLAY_TYPES).map((t) => [t, P.buildVars(this.cfg.palette, t)])),
      categories: L.CATEGORIES,
      games: L.GAMES,
    };
  }

  changed(persist = true) {
    if (persist) this.cfg.save();
    this.onChange();
  }

  // ---------- действия из панели ----------
  apply(a) {
    const touch = (l) => { l.updatedAt = new Date().toISOString(); };
    switch (a.type) {
      case 'app.set': {
        for (const k of ['autoSwitch', 'locked', 'hiddenAll', 'demo', 'onlyWhenFocused', 'autoUpdate', 'lastSeenVersion', 'gameChosen']) if (k in a) this.cfg[k] = a[k];
        if ('game' in a && L.GAMES[a.game]) this.cfg.game = a.game;
        if ('autoSwitch' in a) this.manual = null;
        break;
      }
      case 'palette.set': case 'palette.preset': case 'palette.reset':
        if (!P.apply(this.cfg.palette ||= P.emptyPalette(), a)) return;
        break;

      case 'panel.select':
        this.panelSelection = a.layoutId ? { layoutId: a.layoutId, variation: a.variation || 'base' } : null;
        return this.changed(false);

      case 'layout.create': {
        const l = L.createLayout(a.name || 'Новая раскладка', [L.createOverlay('relative', { x: 500, y: 40 })]);
        L.ensureLayoutTypes(l);
        this.layouts.push(l);
        this.panelSelection = { layoutId: l.id, variation: 'base' };
        break;
      }
      case 'layout.duplicate': {
        const src = this.layout(a.id);
        if (!src) return;
        const copy = L.clone(src);
        copy.id = L.uid('layout');
        copy.name = `${src.name} (копия)`;
        copy.isDefault = false;
        this.layouts.splice(this.layouts.indexOf(src) + 1, 0, copy);
        this.panelSelection = { layoutId: copy.id, variation: 'base' };
        break;
      }
      case 'layout.delete': {
        if (this.layouts.length <= 1) return;
        const i = this.layouts.findIndex((l) => l.id === a.id);
        if (i < 0) return;
        const [gone] = this.layouts.splice(i, 1);
        if (gone.isDefault) this.layouts[0].isDefault = true;
        if (this.cfg.activeLayoutId === gone.id) this.cfg.activeLayoutId = null;
        if (this.panelSelection?.layoutId === gone.id) this.panelSelection = { layoutId: this.layouts[0].id, variation: 'base' };
        break;
      }
      case 'layout.update': {
        const l = this.layout(a.id);
        if (!l) return;
        const p = a.patch || {};
        if (typeof p.name === 'string') l.name = p.name.trim() || l.name;
        if (p.carFilter) l.carFilter = { type: p.carFilter.type, values: (p.carFilter.values || []).map(String).filter(Boolean) };
        if (Array.isArray(p.sessionTypes)) l.sessionTypes = p.sessionTypes.length ? p.sessionTypes : ['all'];
        if (p.isDefault) this.layouts.forEach((x) => { x.isDefault = x === l; });
        touch(l);
        break;
      }
      case 'layout.activate': {
        const l = this.layout(a.id);
        if (!l) return;
        this.cfg.activeLayoutId = l.id;
        this.manual = { layoutId: l.id, key: this.simKey() };
        break;
      }
      case 'layout.addCurrentCar': {
        const l = this.layout(a.id);
        if (!l || !this.sim.car) return;
        if (l.carFilter.type !== 'car') l.carFilter = { type: 'car', values: [] };
        if (!l.carFilter.values.includes(this.sim.car)) l.carFilter.values.push(this.sim.car);
        touch(l);
        break;
      }
      case 'variation.enable': {
        const l = this.layout(a.layoutId);
        if (!l || !L.VARIATIONS.includes(a.variation)) return;
        l.variations = l.variations || {};
        // как в Edge: вариант начинается с копии основного набора (те же id — окна не пересоздаются)
        l.variations[a.variation] = { enabled: true, overlays: L.clone(l.overlays) };
        this.panelSelection = { layoutId: l.id, variation: a.variation };
        touch(l);
        break;
      }
      case 'variation.disable': {
        const l = this.layout(a.layoutId);
        if (!l?.variations) return;
        delete l.variations[a.variation];
        if (this.panelSelection?.variation === a.variation) this.panelSelection.variation = 'base';
        touch(l);
        break;
      }
      // Оверлеи не добавляются и не удаляются: каждый тип всегда есть в наборе, его включают и выключают.
      // Удалить можно только лишнюю копию, оставшуюся от старых версий, где было «Дублировать».
      case 'overlay.remove': {
        const list = this.overlayList(a.layoutId, a.variation);
        const i = list?.findIndex((o) => o.id === a.overlayId) ?? -1;
        if (i < 0 || list.filter((o) => o.type === list[i].type).length < 2) return;
        list.splice(i, 1);
        break;
      }
      case 'overlay.update': {
        const list = this.overlayList(a.layoutId, a.variation);
        const o = list?.find((x) => x.id === a.overlayId);
        if (!o) return;
        const p = a.patch || {};
        if (typeof p.name === 'string') o.name = p.name.trim() || o.name;
        if (typeof p.enabled === 'boolean') o.enabled = p.enabled;
        if (Number.isFinite(p.bgOpacity)) o.bgOpacity = Math.min(1, Math.max(0, p.bgOpacity));
        if (Number.isFinite(p.scale)) o.scale = Math.min(3, Math.max(0.5, p.scale));
        if (p.split === null) o.split = null;
        else if (Number.isFinite(p.split)) o.split = Math.min(0.85, Math.max(0.15, p.split));
        if (typeof p.autoScale === 'boolean') o.autoScale = p.autoScale;
        if (Number.isFinite(p.width)) o.width = Math.round(Math.min(2400, Math.max(120, p.width)));
        if (p.visibility) o.visibility = { ...o.visibility, ...p.visibility };
        if ((p.flagLayout === 'big' || p.flagLayout === 'strip') && p.flagLayout !== o.flagLayout) {
          o.flagLayout = p.flagLayout;
          o.width = Math.round(o.height * (o.flagLayout === 'strip' ? 2 * 4 / 15 + 0.03 : 1));
        }
        if (typeof p.hideEmpty === 'boolean') o.hideEmpty = p.hideEmpty;
        if (Number.isFinite(p.radarRange)) o.radarRange = Math.min(40, Math.max(8, p.radarRange));
        if (Number.isFinite(p.radarIdle)) o.radarIdle = Math.min(1, Math.max(0, p.radarIdle));
        if (typeof p.radarDist === 'boolean') o.radarDist = p.radarDist;
        if (typeof p.radarClass === 'boolean') o.radarClass = p.radarClass;
        if (p.sectors && typeof p.sectors === 'object') o.sectors = L.normalizeSectors(o.sectors, p.sectors);
        if (p.traffic && typeof p.traffic === 'object') o.traffic = L.normalizeTraffic(o.traffic, p.traffic);
        if (p.rel && typeof p.rel === 'object') o.rel = L.normalizeRel(o.rel, p.rel);
        if (p.decimals === null) o.decimals = {};
        else if (p.decimals && typeof p.decimals === 'object') o.decimals = L.normalizeDecimals(o.decimals, p.decimals);
        if (p.sizes === null) o.sizes = {};
        else if (p.sizes && typeof p.sizes === 'object') o.sizes = L.normalizeSizes(o.sizes, p.sizes);
        if (p.pitlimit && typeof p.pitlimit === 'object') o.pitlimit = L.normalizePitlimit(o.pitlimit, p.pitlimit);
        if (p.sr && typeof p.sr === 'object') o.sr = L.normalizeSr(o.sr, p.sr);
        if (p.forecast && typeof p.forecast === 'object') o.forecast = L.normalizeForecast(o.forecast, p.forecast);
        if (p.radarbars && typeof p.radarbars === 'object') o.radarbars = L.normalizeRadarbars(o.radarbars, p.radarbars);
        if (p.fuel && typeof p.fuel === 'object') o.fuel = L.normalizeFuel(o.fuel, p.fuel);
        if (p.rejoin && typeof p.rejoin === 'object') o.rejoin = L.normalizeRejoin(o.rejoin, p.rejoin);
        if (p.laps && typeof p.laps === 'object') o.laps = L.normalizeLaps(o.laps, p.laps);
        if (p.dash && typeof p.dash === 'object') o.dash = L.normalizeDash(o.dash, p.dash);
        if (Array.isArray(p.cards)) o.cards = L.normalizeCards(o.type, p.cards);
        if (Array.isArray(p.header)) o.header = L.normalizeHf(o.type, 'header', p.header);
        if (Array.isArray(p.footer)) o.footer = L.normalizeHf(o.type, 'footer', p.footer);
        if (Array.isArray(p.columns)) o.columns = L.normalizeColumns(o.type, p.columns);
        break;
      }
      default:
        return;
    }
    this.changed();
  }
}

module.exports = { LayoutState };
