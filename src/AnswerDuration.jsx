import React from 'react';

export default function AnswerDuration({ duration, disabled, onChange }) {
  return <div className="answer-duration"><label>作答時間 <select aria-label="本題及後續作答時間" value={duration} disabled={disabled} onChange={e => onChange(Number(e.target.value))}>{[120, 180, 300].map(seconds => <option key={seconds} value={seconds}>{seconds / 60} 分鐘</option>)}</select></label><p>變更後從本題起，後續所有題目都使用此時間。</p></div>;
}
