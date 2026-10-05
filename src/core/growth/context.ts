/** The model sees currency-labelled amounts, never ambiguous integer cents. */
export function modelContext(value: unknown, currency: string): unknown {
  if (Array.isArray(value))
    return value.map((item) => modelContext(item, currency));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key.endsWith('Cents') && typeof item === 'number')
          return [key.slice(0, -5), `${currency} ${(item / 100).toFixed(2)}`];
        return [key, modelContext(item, currency)];
      }),
    );
  return value;
}

export function assertGroundedMoney(
  output: unknown,
  context: unknown,
  currency: string,
): void {
  const amounts = new Set<number>([0]);
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        if (key.endsWith('Cents') && typeof item === 'number')
          amounts.add(Math.round(item));
        else collect(item);
      }
  };
  collect(context);
  const symbol =
    currency === 'USD' || currency === 'CAD' || currency === 'AUD'
      ? '\\$'
      : currency === 'EUR'
        ? '€'
        : currency === 'GBP'
          ? '£'
          : null;
  const code = currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:${symbol ? `${symbol}|` : ''}\\b${code}\\s*)([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`,
    'g',
  );
  for (const match of JSON.stringify(output).matchAll(pattern)) {
    const cents = Math.round(Number(match[1]?.replaceAll(',', '')) * 100);
    if (!amounts.has(cents))
      throw new Error(
        `Unsupported monetary amount ${match[0]}. Use only the currency-labelled amounts supplied in the context; do not interpret cents as dollars.`,
      );
  }
}
