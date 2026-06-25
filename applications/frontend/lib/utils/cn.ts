import { clsx, type ClassValue } from "clsx";

/**
 * Utility function for conditionally joining classNames together.
 * Uses clsx under the hood for flexibility.
 * 
 * @example
 * cn("base-class", condition && "conditional-class", { "active": isActive })
 */
export function cn(...inputs: ClassValue[]) {
    return clsx(inputs);
}
