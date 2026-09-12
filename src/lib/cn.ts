/// Joins class names, dropping falsy ones. Keeps conditional Tailwind classes
/// readable without pulling in a dependency for it.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
