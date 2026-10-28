// Общее для столбиков педалей (Dash и Pedals).
// ABS в iRacing включается и выключается импульсами — флаг меняется почти каждый кадр.
// Держим подсветку ещё немного после последнего импульса, чтобы она горела ровно, а не мерцала.
export function absLatch(holdMs = 300) {
  let until = 0;
  return (m) => {
    const now = performance.now();
    if (m.abs && (m.brake ?? 0) > 0.05) until = now + holdMs;
    return now < until && (m.brake ?? 0) > 0.05;
  };
}
