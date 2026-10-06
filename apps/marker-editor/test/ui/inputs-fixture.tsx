/** @jsxImportSource preact */
/**
 * JSX fixture for the component tests of the form controls (inputs.test.ts): a Row, a wide Row,
 * an InfoRow and a ValueInput for an integer in [1, 100], rendered with Preact into `root`.
 */
import { render } from 'preact';
import { InfoRow, Row, ValueInput } from '../../src/ui/components/inputs.tsx';
import { parseIntRange } from '../../src/ui/format.ts';

export interface InputsFixture {
  /** Values committed by the ValueInput, in order. */
  readonly commits: number[];
  /** Re-renders with a new model value (as after an undo). */
  setValue(v: number): void;
  unmount(): void;
}

export function mountInputsFixture(root: HTMLElement, initial: number): InputsFixture {
  const commits: number[] = [];
  let current = initial;
  const draw = (): void => {
    render(
      <div>
        <Row label="Modus">
          <select data-testid="plain-select">
            <option value="a">A</option>
          </select>
        </Row>
        <Row label="Behalten" wide title="full label">
          <select data-testid="wide-select">
            <option value="b">B</option>
          </select>
        </Row>
        <InfoRow label="Props" value="42" testId="info-value" />
        <ValueInput
          testId="density"
          label="Dichte"
          value={String(current)}
          parse={(t) => parseIntRange(t, 1, 100)}
          isCurrent={(v) => v === current}
          onCommit={(v) => {
            commits.push(v);
            current = v;
            draw();
          }}
        />
      </div>,
      root,
    );
  };
  draw();
  return {
    commits,
    setValue(v: number): void {
      current = v;
      draw();
    },
    unmount(): void {
      render(null, root);
    },
  };
}
