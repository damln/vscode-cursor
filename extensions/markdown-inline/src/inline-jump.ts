import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_COLOR,
  DEFAULT_PRIMARY_CHARSET,
  DEFAULT_WORD_END_REGEXP,
  DEFAULT_WORD_REGEXP,
  DEFAULT_WORD_REGEXP_FLAGS,
  createJumpCodeSet,
} from "../jump-model";

export interface InlineJumpOptions {
  matchStartOfWord: boolean;
  expandSelection: boolean;
  primaryCharset?: string;
  wordRegexp?: string;
  wordRegexpEndOfWord?: string;
  wordRegexpFlags?: string;
  color?: string;
  backgroundColor?: string;
}

interface JumpTarget {
  position: number;
  left: number;
  top: number;
}

interface ActiveJump {
  view: EditorView;
  anchor: number;
  expandSelection: boolean;
  positions: Map<string, number>;
  typed: string;
}

function compileRegexp(source: string, flags: string, fallbackSource: string): RegExp {
  const globalFlags = flags.includes("g") ? flags : `${flags}g`;
  try {
    return new RegExp(source, globalFlags);
  } catch {
    return new RegExp(fallbackSource, DEFAULT_WORD_REGEXP_FLAGS);
  }
}

function targetIsVisible(target: JumpTarget, viewport: DOMRect): boolean {
  return (
    target.top >= viewport.top &&
    target.top <= viewport.bottom &&
    target.left >= viewport.left &&
    target.left <= viewport.right
  );
}

function collectTargets(view: EditorView, options: InlineJumpOptions): JumpTarget[] {
  const source = options.matchStartOfWord
    ? options.wordRegexp || DEFAULT_WORD_REGEXP
    : options.wordRegexpEndOfWord || DEFAULT_WORD_END_REGEXP;
  const regexp = compileRegexp(
    source,
    options.wordRegexpFlags || DEFAULT_WORD_REGEXP_FLAGS,
    options.matchStartOfWord ? DEFAULT_WORD_REGEXP : DEFAULT_WORD_END_REGEXP
  );
  const viewport = view.dom.getBoundingClientRect();
  const cursor = view.coordsAtPos(view.state.selection.head);
  const targets: JumpTarget[] = [];

  view.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    regexp.lastIndex = 0;
    for (const match of node.text.matchAll(regexp)) {
      if (match.index === undefined) continue;
      const targetPosition = position + match.index;
      try {
        const coordinates = view.coordsAtPos(targetPosition);
        const target = {
          position: targetPosition,
          left: coordinates.left,
          top: coordinates.top,
        };
        if (targetIsVisible(target, viewport)) targets.push(target);
      } catch {
        // Ignore positions that are temporarily absent from the rendered viewport.
      }
    }
  });

  return targets.sort((a, b) => {
    const aLineDistance = Math.abs(a.top - cursor.top);
    const bLineDistance = Math.abs(b.top - cursor.top);
    if (aLineDistance !== bLineDistance) return aLineDistance - bLineDistance;
    return (
      Math.abs(a.position - view.state.selection.head) -
        Math.abs(b.position - view.state.selection.head) ||
      a.position - b.position
    );
  });
}

export class InlineJumpController {
  private active: ActiveJump | null = null;
  private labels: HTMLElement[] = [];
  private readonly announce: (message: string) => void;

  constructor(announce: (message: string) => void) {
    this.announce = announce;
  }

  start(view: EditorView, options: InlineJumpOptions) {
    this.clear();
    const targets = collectTargets(view, options);
    const codes = createJumpCodeSet(options.primaryCharset || DEFAULT_PRIMARY_CHARSET);
    const positions = new Map<string, number>();
    targets.slice(0, codes.length).forEach((target, index) => {
      const code = codes[index];
      positions.set(code, target.position);
      const label = document.createElement("span");
      label.className = "inline-jump-label";
      label.textContent = code;
      label.style.left = `${target.left}px`;
      label.style.top = `${target.top}px`;
      label.style.color = options.color || DEFAULT_COLOR;
      label.style.backgroundColor = options.backgroundColor || DEFAULT_BACKGROUND_COLOR;
      document.body.append(label);
      this.labels.push(label);
    });

    if (!positions.size) {
      this.announce("No Jump targets");
      return;
    }
    this.active = {
      view,
      anchor: view.state.selection.anchor,
      expandSelection: options.expandSelection,
      positions,
      typed: "",
    };
  }

  clear() {
    this.labels.forEach(label => label.remove());
    this.labels = [];
    this.active = null;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const active = this.active;
    if (!active) return false;

    if (["Escape", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.clear();
      return true;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      event.stopImmediatePropagation();
      active.typed = active.typed.slice(0, -1);
      return true;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) {
      return false;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const character = event.key.toLowerCase();
    if (!/^[a-z0-9]$/.test(character)) {
      active.typed = "";
      return true;
    }
    active.typed += character;
    if (active.typed.length < 2) return true;

    const position = active.positions.get(active.typed);
    if (position === undefined) {
      this.clear();
      this.announce("Unknown Jump target");
      return true;
    }
    const { view } = active;
    const selection = active.expandSelection
      ? TextSelection.create(view.state.doc, active.anchor, position)
      : TextSelection.create(view.state.doc, position);
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    this.clear();
    view.focus();
    return true;
  }
}
