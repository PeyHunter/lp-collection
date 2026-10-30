const shapes: [RegExp, (typed: string) => string][] = [
  [/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/, (typed) => typed.replaceAll(".", "").replace(",", ".")],
  [/^\d+(,\d{1,2})?$/, (typed) => typed.replace(",", ".")],
  [/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/, (typed) => typed.replaceAll(",", "")],
  [/^\d+(\.\d{1,2})?$/, (typed) => typed],
];

/**
 * Reads an amount typed the Danish way ("1.200,50") or the English way ("1,200.50").
 * Empty means no amount (null); anything else that isn't an amount is undefined.
 */
export function parseTypedAmount(typed: string): number | null | undefined {
  const compact = typed.replaceAll(/\s/g, "");
  if (compact === "") return null;
  const shape = shapes.find(([pattern]) => pattern.test(compact));
  return shape ? Number(shape[1](compact)) : undefined;
}

const editable = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 2 });

export function typedAmount(amount: number) {
  return editable.format(amount);
}
