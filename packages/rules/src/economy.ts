/** Integer flow contract: resources are milli-units, ratios and completion are Q16. */
export const ECO_ONE = 65536;
export const ECO_MILLI = 1000;
/** Exact floor(a*b/divisor) without an unsafe intermediate product. */
export function mulDiv(a: number, b: number, divisor: number): number {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(divisor) || a < 0 || b < 0 || divisor <= 0)
        throw new RangeError('invalid integer mulDiv');
    let whole = Math.floor(a / divisor), rem = a % divisor, result = 0, carry = 0;
    while (b > 0) {
        if (b % 2 === 1) {
            result += whole;
            // rem + carry may exceed safe integer range: compare before adding.
            if (carry >= divisor - rem) {
                result++;
                carry -= divisor - rem;
            }
            else
                carry += rem;
        }
        b = Math.floor(b / 2);
        if (b === 0)
            break;
        whole *= 2;
        if (rem >= divisor - rem) {
            whole++;
            rem -= divisor - rem;
        }
        else
            rem *= 2;
    }
    if (!Number.isSafeInteger(result))
        throw new RangeError('integer mulDiv overflow');
    return result;
}
export function stallRatio(available: number, demand: number): number {
    return demand <= 0 || available >= demand ? ECO_ONE : mulDiv(available, ECO_ONE, demand);
}
/** Cumulative accounting makes the last payment exactly the original cost. */
export function cumulativeCost(costMilli: number, doneQ16: number): number {
    return mulDiv(costMilli, doneQ16, ECO_ONE);
}
