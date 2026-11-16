"use client";

import type { Field, Setup } from "../engine/types.ts";
import { addField, hasKind, newBeam, newGravity, newPaulTrap, type PartId } from "./model.ts";
import { Icon } from "./ui/Icon.tsx";
import { Menu, MenuItem } from "./ui/Menu.tsx";
import ui from "./ui/ui.module.css";
import styles from "./AddField.module.css";

export interface AddFieldProps {
  setup: Setup;
  onEdit(setup: Setup, select?: PartId | null): void;
  /** where the menu opens */
  side?: "above" | "below";
}

/** "+ Add field": every field arrives with working values, selected, with its inputs open. */
export function AddField({ setup, onEdit, side = "above" }: AddFieldProps) {
  const beams = hasKind(setup, "beam");
  const paul = hasKind(setup, "paul");
  const gravity = hasKind(setup, "gravity");
  return (
    <Menu
      label="Add a field"
      side={side}
      button={(p) => (
        <button type="button" className={`${ui.island} ${ui.button} ${styles.add}`} data-testid="add-field" {...p}>
          <Icon name="plus" />
          Add field
        </button>
      )}
    >
      {(close) => {
        const add = (field: Field) => {
          close();
          onEdit(addField(setup, field), `field:${setup.trap.fields.length}`);
        };
        return (
          <>
            {beams ? (
              <>
                <MenuItem
                  icon="beam"
                  title="Counter-propagating beam"
                  note="Opposes the first beam at the same focus"
                  testId="add-counter-beam"
                  onSelect={() => add(newBeam(setup, "counter"))}
                />
                <MenuItem
                  icon="beam"
                  title="Co-propagating beam"
                  note="Travels with the first beam; the two can interfere"
                  testId="add-co-beam"
                  onSelect={() => add(newBeam(setup, "co"))}
                />
              </>
            ) : (
              <MenuItem icon="beam" title="Beam" note="A focused laser beam along z" testId="add-beam" onSelect={() => add(newBeam(setup, "co"))} />
            )}
            <MenuItem
              icon="paul"
              title="Linear Paul trap"
              note="Four RF rods and two end caps"
              tag={paul ? "in the trap" : undefined}
              disabled={paul}
              testId="add-paul-linear"
              onSelect={() => add(newPaulTrap("linear"))}
            />
            <MenuItem
              icon="paul"
              title="Ring Paul trap"
              note="An RF ring and two end caps"
              tag={paul ? "in the trap" : undefined}
              disabled={paul}
              testId="add-paul-ring"
              onSelect={() => add(newPaulTrap("ring"))}
            />
            <MenuItem
              icon="gravity"
              title="Gravity"
              note="9.81 m/s² downwards"
              tag={gravity ? "in the trap" : undefined}
              disabled={gravity}
              testId="add-gravity"
              onSelect={() => add(newGravity())}
            />
          </>
        );
      }}
    </Menu>
  );
}
