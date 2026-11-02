export function controlClipKind(phase) {
  if (['playing', 'answering', 'closing', 'locked'].includes(phase)) return 'question';
  if (['revealed', 'results', 'finished'].includes(phase)) return 'answer';
  return null;
}

export function canKeepControlPreview(preview, room) {
  return !!preview && !!room && preview.code === room.code && preview.round === room.round && preview.kind === controlClipKind(room.phase);
}
