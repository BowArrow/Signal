import type { KeyboardEvent } from 'react';

export function SectionTabs<T extends string>({ id, label, items, value, onChange }: {
  id: string;
  label: string;
  items: readonly { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next]!.key);
    document.getElementById(`${id}-tab-${items[next]!.key}`)?.focus();
  };
  return <div className="section-tabs" role="tablist" aria-label={label}>
    {items.map((item, index) => <button key={item.key} type="button" role="tab"
      id={`${id}-tab-${item.key}`} aria-controls={`${id}-panel-${item.key}`}
      aria-selected={value === item.key} tabIndex={value === item.key ? 0 : -1}
      onKeyDown={event => onKeyDown(event, index)} onClick={() => onChange(item.key)}>
      {item.label}{item.count !== undefined && <span className="section-count">{item.count}</span>}
    </button>)}
  </div>;
}
