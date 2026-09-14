export const NO_AUTOCORRECT_ATTRS: Record<string, string> = {
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
};

export function disableAutocorrect(element: HTMLElement): void {
  for (const [name, value] of Object.entries(NO_AUTOCORRECT_ATTRS)) {
    element.setAttribute(name, value);
  }
}
