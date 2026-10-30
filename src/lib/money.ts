/**
 * Money is stored and calculated as integer paise (₹1 = 100 paise) everywhere.
 * Conversion to rupees happens only here, at the point of display.
 */

const wholeRupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const rupeesAndPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a non-negative integer amount of paise as Indian rupees with Indian
 * digit grouping: 14999900 → "₹1,49,999", 149950 → "₹1,499.50".
 *
 * Signs (discounts, refunds) are a presentation concern for the caller.
 */
export function formatINR(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(
      `Expected an integer number of paise, received ${String(paise)}`,
    );
  }
  if (paise < 0) {
    throw new RangeError(
      `Expected a non-negative amount of paise, received ${paise}`,
    );
  }

  const rupees = paise / 100;
  return paise % 100 === 0
    ? wholeRupees.format(rupees)
    : rupeesAndPaise.format(rupees);
}
