import { LANGUAGES, type Language, type ReadingOptions, type SourceLanguage } from './reader-messages';
import { SegmentedControl } from './segmented-control';

type Props = { value: ReadingOptions; change: (value: ReadingOptions) => void; locked?: boolean };
const languages = Object.entries(LANGUAGES);
const ranges = [
  { value: 'visible', label: '整页可见文字' },
  { value: 'main', label: '仅正文' },
] as const;

export function LanguageFields({ value, change, locked }: Props) {
  return <fieldset className="language-fields" disabled={locked}>
    <label>原文语言
      <select value={value.source} onChange={(event) => change({ ...value, source: event.target.value as SourceLanguage })}>
        <option value="auto">自动检测</option>
        {languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
    </label>
    <label>译文语言
      <select value={value.target} onChange={(event) => change({ ...value, target: event.target.value as Language })}>
        {languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
    </label>
    <SegmentedControl label="翻译范围" className="translation-range-field full" options={ranges}
      value={value.range} change={(range) => change({ ...value, range })} disabled={locked} />
  </fieldset>;
}
