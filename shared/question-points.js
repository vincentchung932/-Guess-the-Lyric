export function validQuestionPoints(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000000 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
}
