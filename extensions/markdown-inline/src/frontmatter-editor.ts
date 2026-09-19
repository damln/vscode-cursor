import { updateMetadataColors } from './lib/metadata-colors';
import { Frontmatter, metadataEnvelope } from './lib/frontmatter';

export class FrontmatterEditor {
  private model = new Frontmatter('');
  private envelope = metadataEnvelope('', '\n');
  private present = false;
  private mode: 'fields' | 'yaml' = 'fields';
  private toggle = document.createElement('button');
  private error = document.createElement('p');
  private newField: {name: string; value: string} | null = null;
  private creatingMetadata = false;
  private expanded: boolean;
  private fieldResize?: ResizeObserver;
  private closeRemoval?: (restoreFocus?: boolean) => void;
  constructor(private card: HTMLElement, private fields: HTMLElement,
    private add: HTMLButtonElement, private onChange: (prefix: string) => void,
    expanded = false, private onExpanded = (_expanded: boolean) => {}) {
    this.expanded = expanded;
    this.toggle.type = 'button';
    this.toggle.id = 'frontmatter-toggle';
    this.toggle.setAttribute('aria-controls', fields.id);
    this.toggle.addEventListener('click', () => {
      this.expanded = !this.expanded; this.onExpanded(this.expanded); this.render();
    });
    card.querySelector('.frontmatter-header')?.replaceChildren(this.toggle, add);
    this.error.className = 'frontmatter-error';
    this.error.setAttribute('role', 'status');
    card.append(this.error);
    add.addEventListener('click', () => {
      this.creatingMetadata = true;
      this.present = true; this.expanded = true; this.mode = 'fields';
      this.newField = {name: '', value: ''};
      this.onExpanded(true);
      this.render();
      fields.querySelector<HTMLInputElement>('#metadata-new-name')?.focus();
    });
  }
  load(prefix: string, eol: string) {
    this.envelope = metadataEnvelope(prefix, eol);
    this.model = new Frontmatter(this.envelope.raw);
    this.present = Boolean(prefix);
    this.creatingMetadata = false;
    this.newField = null;
    this.card.hidden = false;
    this.render();
  }
  private updateHeader() {
    const label = document.createElement('span');
    label.textContent = `Metadata · ${this.model.fields().length}${this.model.error ? ' · Needs attention' : ''}`;
    const action = document.createElement('span'); action.className = 'metadata-disclosure';
    action.textContent = this.expanded ? 'Hide' : 'Show';
    action.insertAdjacentHTML('beforeend', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>');
    this.toggle.replaceChildren(label, action);
    this.card.dataset.present = String(this.present);
    this.toggle.hidden = !this.present;
    this.toggle.setAttribute('aria-expanded', String(this.expanded));
    this.fields.hidden = !this.present || !this.expanded;
    this.add.textContent = 'Add metadata';
    this.add.hidden = this.present;
    this.error.textContent = this.model.error ? 'YAML needs attention. Your source is retained. ' + this.model.error : '';
    this.error.hidden = !this.model.error;
  }
  private publish(source: string) {
    this.closeRemoval?.();
    this.model = new Frontmatter(source);
    this.present = true;
    this.creatingMetadata = false;
    this.updateHeader();
    this.onChange(this.envelope.join(source));
  }
  private render() {
    this.closeRemoval?.();
    this.fieldResize?.disconnect();
    this.fields.replaceChildren();
    const controls = document.createElement('div');
    controls.className = 'metadata-modes';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Metadata view');
    for (const mode of ['fields', 'yaml'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = mode === 'fields' ? 'Fields' : 'YAML';
      button.setAttribute('aria-pressed', String(mode === this.mode));
      button.addEventListener('click', () => {
        this.mode = mode; this.render();
        this.fields.querySelector<HTMLButtonElement>(`button[aria-pressed="true"]`)?.focus();
      });
      controls.append(button);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = 'Remove metadata'; remove.className = 'metadata-remove';
    remove.addEventListener('click', () => this.confirmRemoval(remove, 'Remove all metadata?',
      'All frontmatter fields will be removed. The document body stays unchanged.', 'Remove metadata', () => {
      this.present = false; this.newField = null; this.creatingMetadata = false;
      this.model = new Frontmatter(''); this.updateHeader();
      this.onChange(''); this.add.focus();
    }));
    controls.append(remove);
    this.fields.append(controls);
    if (this.mode === 'yaml') {
      const raw = document.createElement('textarea');
      raw.className = 'frontmatter-source';
      raw.setAttribute('aria-label', 'Front matter YAML source');
      raw.spellcheck = false; raw.value = this.model.raw;
      raw.rows = Math.min(20, Math.max(4, this.model.raw.split('\n').length));
      const palette = document.createElement('div'); palette.className = 'metadata-color-palette';
      palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', 'Colors in YAML');
      const updateColors = () => updateMetadataColors(palette, raw, true);
      raw.addEventListener('input', () => { this.publish(raw.value); updateColors(); });
      updateColors(); this.fields.append(raw, palette);
    } else {
      const modelFields = this.model.fields();
      if (!modelFields.length && !this.model.error) {
        const empty = document.createElement('p'); empty.className = 'metadata-empty';
        empty.textContent = 'No fields yet. Add your first field below.'; this.fields.append(empty);
      }
      const sizes = new Map<HTMLTextAreaElement, number>();
      const resize = (input: HTMLTextAreaElement) => {
        if (!input.getClientRects().length) return;
        input.style.height = 'auto';
        const style = getComputedStyle(input);
        input.style.height = `${Math.ceil(input.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth))}px`;
      };
      this.fieldResize = new ResizeObserver(entries => {
        for (const entry of entries) {
          const input = entry.target as HTMLTextAreaElement;
          if (sizes.get(input) !== entry.contentRect.width) {
            sizes.set(input, entry.contentRect.width); resize(input);
          }
        }
      });
      for (const [index, field] of modelFields.entries()) {
        const row = document.createElement('div'); row.className = 'frontmatter-row';
        const key = document.createElement('label'); key.className = 'frontmatter-key'; key.textContent = field.label;
        key.htmlFor = `metadata-value-${index}`;
        const input = document.createElement('textarea');
        input.id = key.htmlFor;
        input.className = 'frontmatter-value'; input.value = field.value;
        input.rows = Math.min(8, Math.max(1, field.value.split('\n').length));
        input.readOnly = !field.editable;
        input.title = field.editable ? 'YAML value: quotes are optional and control the value type' : `${field.type}: edit in YAML source`;
        input.setAttribute('aria-label', `${field.label} (${field.type})`);
        const value = document.createElement('div'); value.className = 'frontmatter-value-wrap';
        const colors = document.createElement('div'); colors.className = 'metadata-field-colors';
        const updateColors = () => updateMetadataColors(colors, input);
        updateColors(); value.append(colors, input);
        input.addEventListener('input', () => {
          updateColors(); resize(input);
          try { this.publish(this.model.editValue(field.path, input.value)); }
          catch (reason) { this.error.hidden = false; this.error.textContent = String(reason); }
        });
        const removeField = document.createElement('button');
        removeField.type = 'button'; removeField.className = 'frontmatter-delete';
        removeField.setAttribute('aria-label', `Remove field ${field.label}`);
        removeField.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7"/></svg><span>Remove</span>';
        removeField.addEventListener('click', () => this.confirmRemoval(removeField, `Remove field “${field.label}”?`,
          'This field and its value will be removed.', 'Remove field', () => {
          try {
            this.publish(this.model.removeField(field.path)); this.render();
            const remaining = this.fields.querySelectorAll<HTMLButtonElement>('.frontmatter-delete');
            (remaining[Math.min(index, remaining.length - 1)] || this.toggle).focus();
          } catch (reason) {
            this.error.hidden = false; this.error.textContent = String(reason);
          }
        }));
        row.append(key, value, removeField); this.fields.append(row);
        this.fieldResize.observe(input);
      }
      this.renderAddField();
    }
    this.updateHeader();
  }
  private confirmRemoval(trigger: HTMLButtonElement, title: string, description: string, label: string, remove: () => void) {
    this.closeRemoval?.();
    const panel = document.createElement('div'); panel.className = 'metadata-confirm';
    panel.setAttribute('role', 'group'); panel.setAttribute('aria-labelledby', 'metadata-confirm-title');
    const heading = document.createElement('strong'); heading.id = 'metadata-confirm-title'; heading.textContent = title;
    const detail = document.createElement('p'); detail.id = 'metadata-confirm-detail'; detail.textContent = description;
    const actions = document.createElement('div'); actions.className = 'metadata-new-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.setAttribute('aria-describedby', heading.id + ' ' + detail.id);
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'metadata-confirm-remove'; confirm.textContent = label;
    const close = (restoreFocus = false) => {
      panel.remove(); this.closeRemoval = undefined;
      trigger.removeAttribute('aria-expanded'); trigger.removeAttribute('aria-controls');
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onOutside, true);
      if (restoreFocus && trigger.isConnected) trigger.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    const onOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !trigger.contains(event.target)) close();
    };
    cancel.addEventListener('click', () => close(true));
    confirm.addEventListener('click', () => { close(true); remove(); });
    actions.append(cancel, confirm); panel.append(heading, detail, actions);
    panel.id = 'metadata-confirm'; trigger.after(panel);
    trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', panel.id);
    this.closeRemoval = close;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onOutside, true);
    cancel.focus();
  }
  private renderAddField() {
    if (this.model.error) return;
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'metadata-add-field frontmatter-add';
    trigger.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Add field</span>';
    trigger.hidden = this.newField !== null;
    trigger.addEventListener('click', () => {
      this.newField = {name: '', value: ''}; this.render();
      this.fields.querySelector<HTMLInputElement>('#metadata-new-name')?.focus();
    });
    this.fields.append(trigger);
    if (!this.newField) return;
    const draft = this.newField;
    const form = document.createElement('form'); form.className = 'metadata-new-field'; form.noValidate = true;
    form.setAttribute('aria-label', 'Add metadata field');
    const nameLabel = document.createElement('label'); nameLabel.textContent = 'Field name'; nameLabel.htmlFor = 'metadata-new-name';
    const name = document.createElement('input'); name.id = nameLabel.htmlFor; name.value = draft.name;
    name.placeholder = 'e.g. author or metadata.tags'; name.autocomplete = 'off'; name.spellcheck = false; name.required = true;
    const help = document.createElement('p'); help.id = 'metadata-new-help'; help.className = 'metadata-new-help';
    help.textContent = 'Use dots for nested fields: metadata.tags adds tags inside metadata. Missing levels are created automatically. Values use YAML syntax: [hello] is a list; "[hello]" is text.';
    const valueLabel = document.createElement('label'); valueLabel.textContent = 'Value'; valueLabel.htmlFor = 'metadata-new-value';
    const value = document.createElement('textarea'); value.id = valueLabel.htmlFor; value.value = draft.value; value.rows = 2;
    const actions = document.createElement('div'); actions.className = 'metadata-new-actions';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Add'; submit.disabled = !draft.name.trim();
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const error = document.createElement('p'); error.className = 'metadata-new-error'; error.id = 'metadata-new-error'; error.hidden = true;
    error.setAttribute('role', 'alert'); name.setAttribute('aria-describedby', `${help.id} ${error.id}`);
    name.addEventListener('input', () => {
      draft.name = name.value; submit.disabled = !name.value.trim(); error.hidden = true; name.removeAttribute('aria-invalid');
    });
    value.addEventListener('input', () => { draft.value = value.value; });
    const dismiss = () => {
      this.newField = null;
      if (this.creatingMetadata) { this.present = false; this.creatingMetadata = false; }
      this.render();
      (this.present ? this.fields.querySelector<HTMLButtonElement>('.metadata-add-field') : this.add)?.focus();
    };
    cancel.addEventListener('click', dismiss);
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const source = this.model.addValue(name.value, value.value);
        this.newField = null; this.publish(source); this.render();
        const inputs = this.fields.querySelectorAll<HTMLTextAreaElement>('.frontmatter-value');
        const path = name.value.trim().split('.').map(part => part.trim());
        const index = this.model.fields().findIndex(field => JSON.stringify(field.path) === JSON.stringify(path));
        inputs[index]?.focus();
      } catch (reason) {
        error.textContent = reason instanceof Error ? reason.message : String(reason); error.hidden = false;
        name.setAttribute('aria-invalid', 'true'); name.focus();
      }
    });
    actions.append(submit, cancel);
    form.append(nameLabel, name, help, valueLabel, value, actions, error);
    this.fields.append(form);
  }
}
