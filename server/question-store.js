import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { questionBankPath, validateQuestionBank } from './questions.js';

const versionOf = text => createHash('sha256').update(text).digest('hex');
export class QuestionStore {
  constructor(file = questionBankPath) { this.file = file instanceof URL ? fileURLToPath(file) : file; }
  read() {
    const text = readFileSync(this.file, 'utf8');
    const bank = JSON.parse(text);
    validateQuestionBank(bank, { allowEmpty: true });
    return { bank, version: versionOf(text) };
  }
  active() { return validateQuestionBank(this.read().bank); }
  save(bank, version) {
    if (!Array.isArray(bank) || bank.length > 500) throw new Error('題庫最多 500 題。');
    validateQuestionBank(bank, { allowEmpty: true });
    const current = this.read();
    if (current.version !== version) { const error = new Error('題庫已被另一個視窗或檔案修改，請重新載入後再編輯。'); error.status = 409; throw error; }
    const text = JSON.stringify(bank, null, 2) + '\n';
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      writeFileSync(temporary, text, { flag: 'wx' });
      renameSync(temporary, this.file);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* Temp file may not exist. */ }
      throw error;
    }
    return { bank, version: versionOf(text) };
  }
}

export function isLocalEditorRequest(req) {
  const remote = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    return ['localhost', '127.0.0.1', '[::1]'].includes(host);
  } catch { return false; }
}
