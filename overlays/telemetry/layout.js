// Рабочая область окна «Телеметрия»: блоки стыкуются, как окна в Windows.
// Раскладка — дерево: { leaf: описание блока } или { dir: 'row' | 'col', r: доля первой части, a, b }.
// Блок тянут за ручку (или новый — из галереи слева): у края другого блока он встаёт рядом с ним (половина),
// у края всей области — во всю её высоту или ширину, в середину — меняется местами (новый — заменяет).
// Полупрозрачная подсказка показывает, куда встанет блок. Блок, унесённый на панель слева, убирается.

export const MAX_BLOCKS = 6;
const EDGE_PX = 26;      // у края всей области — стыковка во всю высоту/ширину
const SIDE_FRAC = 0.3;   // ближе к краю блока, чем 30% его размера, — встать рядом; иначе — в середину

// Готовые раскладки (меню «Раскладка»): блоки раскладываются по ячейкам по порядку
export const PRESETS = [
  { id: 'full', title: 'Один блок', tree: 'c' },
  { id: 'rows', title: 'Сверху и снизу', tree: ['col', 'c', 'c'] },
  { id: 'cols', title: 'Слева и справа', tree: ['row', 'c', 'c'] },
  { id: 't2b1', title: 'Два сверху, один снизу', tree: ['col', ['row', 'c', 'c'], 'c'] },
  { id: 't1b2', title: 'Один сверху, два снизу', tree: ['col', 'c', ['row', 'c', 'c']] },
  { id: 'l1r2', title: 'Один слева, два справа', tree: ['row', 'c', ['col', 'c', 'c']] },
  { id: 'l2r1', title: 'Два слева, один справа', tree: ['row', ['col', 'c', 'c'], 'c'] },
  { id: 'quad', title: 'Четыре', tree: ['row', ['col', 'c', 'c'], ['col', 'c', 'c']] },
];
export const cellCount = (t) => (t === 'c' ? 1 : cellCount(t[1]) + cellCount(t[2]));

// Дерево готовой раскладки из блоков по порядку
export function presetTree(t, specs) {
  let i = 0;
  const make = (x) => (x === 'c' ? { leaf: specs[i++] } : { dir: x[0], r: 0.5, a: make(x[1]), b: make(x[2]) });
  return make(t);
}

export function presetIcon(tree) {
  const make = (t) => (t === 'c' ? '<i></i>' : `<span class="pi ${t[0]}">${make(t[1])}${make(t[2])}</span>`);
  return `<span class="pi root ${tree === 'c' ? '' : tree[0]}">${tree === 'c' ? '<i></i>' : make(tree[1]) + make(tree[2])}</span>`;
}

export const leavesOf = (n) => (!n ? [] : n.leaf ? [n.leaf] : [...leavesOf(n.a), ...leavesOf(n.b)]);

const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };

export class Dock {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {(spec: object) => HTMLElement} o.blockEl  элемент блока по описанию
   * @param {() => void} o.onChange  раскладка поменялась (блоки, места или размеры)
   * @param {HTMLElement} o.removeZone  куда унести блок, чтобы убрать (панель слева)
   * @param {(text: string) => void} o.note  короткое сообщение пользователю
   */
  constructor(root, { blockEl, onChange, removeZone, note }) {
    this.root = root;
    this.blockEl = blockEl;
    this.onChange = onChange;
    this.removeZone = removeZone;
    this.note = note;
    this.tree = null;
    this.cellOf = new Map(); // элемент ячейки → лист
  }

  get count() { return leavesOf(this.tree).length; }

  setTree(tree) { this.tree = tree; this.render(); }

  render() {
    this.root.textContent = '';
    this.cellOf.clear();
    if (!this.tree) {
      const e = div('ws-blank');
      e.innerHTML = '<b>Пусто</b><span>Перетащите блоки из галереи слева («Блоки»)</span>';
      this.root.append(e);
      return;
    }
    const make = (n) => {
      if (n.leaf) {
        const cell = div('ws-cell');
        cell.append(this.blockEl(n.leaf));
        this.cellOf.set(cell, n);
        return cell;
      }
      const box = div(`ws-split ${n.dir}`);
      const a = make(n.a), g = div('ws-gutter'), b = make(n.b);
      a.style.flex = `${n.r} 1 0`;
      b.style.flex = `${1 - n.r} 1 0`;
      box.append(a, g, b);
      this.gutter(g, box, a, b, n);
      return box;
    };
    const top = make(this.tree);
    top.style.flex = '1 1 0';
    this.root.append(top);
  }

  gutter(g, box, a, b, n) {
    g.title = 'Потяните, чтобы изменить размер';
    let on = false;
    g.addEventListener('pointerdown', (e) => { on = true; try { g.setPointerCapture(e.pointerId); } catch { /* без захвата тоже работает */ } g.classList.add('drag'); });
    g.addEventListener('pointermove', (e) => {
      if (!on) return;
      const r = box.getBoundingClientRect();
      const f = n.dir === 'row' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
      n.r = Math.round(Math.max(0.1, Math.min(0.9, f)) * 1000) / 1000;
      a.style.flex = `${n.r} 1 0`;
      b.style.flex = `${1 - n.r} 1 0`;
    });
    const up = () => { if (!on) return; on = false; g.classList.remove('drag'); this.onChange(); };
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  }

  // ---------- правка дерева ----------

  parentOf(node, n = this.tree, p = null) {
    if (!n || n === node) return n === node ? p : undefined;
    if (n.leaf) return undefined;
    return this.parentOf(node, n.a, n) ?? this.parentOf(node, n.b, n);
  }

  replace(node, by) {
    const p = this.parentOf(node);
    if (!p) this.tree = by;
    else if (p.a === node) p.a = by;
    else p.b = by;
  }

  leafOf(spec, n = this.tree) {
    if (!n) return null;
    if (n.leaf) return n.leaf === spec ? n : null;
    return this.leafOf(spec, n.a) || this.leafOf(spec, n.b);
  }

  // убрать лист: его место занимает соседняя часть
  removeLeaf(leaf) {
    const p = this.parentOf(leaf);
    if (!p) { this.tree = null; return; }
    this.replace(p, p.a === leaf ? p.b : p.a);
  }

  remove(spec) {
    const leaf = this.leafOf(spec);
    if (!leaf) return;
    this.removeLeaf(leaf);
    this.render();
    this.onChange();
  }

  insert(target, side, spec) {
    const leaf = { leaf: spec };
    if (!target) { this.tree = leaf; return; }
    const dir = side === 'left' || side === 'right' ? 'row' : 'col';
    const first = side === 'left' || side === 'top';
    // у края всей области — новая часть поуже, чтобы остальное не сжималось вдвое
    const r = target === this.tree && this.tree && !this.tree.leaf ? (first ? 0.34 : 0.66) : 0.5;
    this.replace(target, { dir, r, a: first ? leaf : target, b: first ? target : leaf });
  }

  // поставить новый блок рядом с target (лист или вся раскладка); в середину — справа
  place(target, side, spec) {
    if (this.count >= MAX_BLOCKS) { this.note(`Не больше ${MAX_BLOCKS} блоков — уберите лишний (✕ в его шапке).`); return false; }
    this.insert(target && this.contains(target) ? target : this.tree, side === 'center' || side === 'all' ? 'right' : side, spec);
    this.render();
    this.onChange();
    return true;
  }

  // добавить блок без перетаскивания: справа от всей области
  add(spec) {
    if (this.count >= MAX_BLOCKS) { this.note(`Не больше ${MAX_BLOCKS} блоков — уберите лишний (✕ в его шапке).`); return; }
    this.insert(this.tree, 'right', spec);
    this.render();
    this.onChange();
  }

  // ---------- перетаскивание ----------

  // куда встанет блок, если отпустить в точке (x, y)
  hit(x, y, dragged) {
    const R = this.root.getBoundingClientRect();
    const inside = x >= R.left && x <= R.right && y >= R.top && y <= R.bottom;
    if (!inside) {
      const z = this.removeZone?.getBoundingClientRect();
      if (dragged && z && x >= z.left && x <= z.right && y >= z.top && y <= z.bottom) return { remove: true };
      return null;
    }
    if (!this.tree) return { target: null, side: 'all', rect: R };
    const half = (r, side) => ({
      left: { left: r.left, top: r.top, width: r.width / 2, height: r.height },
      right: { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height },
      top: { left: r.left, top: r.top, width: r.width, height: r.height / 2 },
      bottom: { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 },
    })[side];
    // край всей области
    const edges = { left: x - R.left, right: R.right - x, top: y - R.top, bottom: R.bottom - y };
    const near = Object.entries(edges).sort((a, b) => a[1] - b[1])[0];
    if (near[1] < EDGE_PX && !(dragged && this.tree.leaf === dragged)) {
      const k = this.tree.leaf ? 0.5 : 0.34;
      const r = near[0] === 'left' ? { left: R.left, top: R.top, width: R.width * k, height: R.height }
        : near[0] === 'right' ? { left: R.right - R.width * k, top: R.top, width: R.width * k, height: R.height }
          : near[0] === 'top' ? { left: R.left, top: R.top, width: R.width, height: R.height * k }
            : { left: R.left, top: R.bottom - R.height * k, width: R.width, height: R.height * k };
      return { target: this.tree, side: near[0], rect: r };
    }
    // блок под курсором
    let cell = null;
    for (const c of this.cellOf.keys()) {
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { cell = c; break; }
    }
    if (!cell) return null;
    const leaf = this.cellOf.get(cell);
    if (dragged && leaf === dragged) return null;
    const r = cell.getBoundingClientRect();
    const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
    const d = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]].sort((a, b) => a[1] - b[1])[0];
    if (d[1] < SIDE_FRAC) return { target: leaf, side: d[0], rect: half(r, d[0]) };
    return { target: leaf, side: 'center', rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
  }

  /**
   * Начать перетаскивание.
   * @param {PointerEvent} e
   * @param {object} o  { spec } — блок, который уже стоит, или { make: () => spec } — новый из галереи; title — подпись
   */
  drag(e, { spec, make, title }) {
    e.preventDefault();
    const dragged = spec ? this.leafOf(spec) : null;
    if (!spec && this.count >= MAX_BLOCKS) { this.note(`Не больше ${MAX_BLOCKS} блоков — уберите лишний (✕ в его шапке).`); return; }
    const ghost = div('ws-ghost');
    ghost.textContent = title;
    const preview = div('dock-preview');
    document.body.append(preview, ghost);
    document.body.classList.add('ws-dragging');
    let h = null;
    const move = (ev) => {
      ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`;
      h = this.hit(ev.clientX, ev.clientY, dragged);
      this.removeZone?.classList.toggle('drop-remove', !!h?.remove);
      if (h?.rect) {
        Object.assign(preview.style, { left: `${h.rect.left}px`, top: `${h.rect.top}px`, width: `${h.rect.width}px`, height: `${h.rect.height}px`, opacity: 1 });
        preview.classList.toggle('center', h.side === 'center');
      } else preview.style.opacity = 0;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      preview.remove();
      document.body.classList.remove('ws-dragging');
      this.removeZone?.classList.remove('drop-remove');
      if (!h) return;
      if (h.remove) { this.removeLeaf(dragged); this.render(); this.onChange(); return; }
      if (dragged) {
        if (h.side === 'center') {
          // поменять местами
          const s = h.target.leaf;
          h.target.leaf = dragged.leaf;
          dragged.leaf = s;
        } else {
          this.removeLeaf(dragged);
          this.insert(h.target === null || !this.contains(h.target) ? this.tree : h.target, h.side, spec);
        }
      } else {
        const fresh = make();
        if (h.side === 'center') h.target.leaf = fresh;
        else this.insert(h.target, h.side === 'all' ? 'right' : h.side, fresh);
      }
      this.render();
      this.onChange();
    };
    move(e);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  contains(node, n = this.tree) {
    if (!n) return false;
    if (n === node) return true;
    return !n.leaf && (this.contains(node, n.a) || this.contains(node, n.b));
  }
}
