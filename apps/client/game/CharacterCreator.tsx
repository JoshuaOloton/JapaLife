"use client";

import { type Appearance, type CharacterCatalog, COPY, fill } from "@japalife/shared";
import { multiply } from "./character/appearance";
import styles from "./hud.module.css";

const text = COPY.creator;

/**
 * Roughly the colour of the body texture's painted skin. Skin tones multiply
 * it, so a swatch shows this times the tone's tint, close to what the
 * character will look like. Display only: the 3D body uses the real texture.
 */
const BASE_SKIN = "#b98463";

/**
 * Make or change your character. Every tap changes the draft, which the
 * parent shows live on your character in the close-up; nothing is saved until
 * Done, when the server checks it and replies. Only free starter options are
 * offered; the server refuses anything else anyway.
 */
export function CharacterCreator({
  catalog,
  draft,
  mode,
  saving,
  onChange,
  onDone,
  onCancel,
}: {
  catalog: CharacterCatalog;
  draft: Appearance;
  /** "create" has no Cancel: a new player must make a character to play. */
  mode: "create" | "change";
  saving: boolean;
  onChange: (draft: Appearance) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof Appearance>(slot: K, id: Appearance[K]): void => onChange({ ...draft, [slot]: id });
  const outfit = catalog.outfits[draft.outfit];

  return (
    <section className={styles.creatorSheet} aria-label={mode === "create" ? text.title : text.changeTitle}>
      <div className={styles.sheetHeader}>
        <h2>{mode === "create" ? text.title : text.changeTitle}</h2>
      </div>

      <Row title={text.body}>
        {starters(catalog.bodies).map(([id], index) => (
          <Choice key={id} on={draft.body === id} onClick={() => set("body", id)}>
            {fill(text.bodyOption, { number: index + 1 })}
          </Choice>
        ))}
      </Row>

      <Row title={text.skin}>
        {starters(catalog.skinTones).map(([id, tone], index) => (
          <Swatch
            key={id}
            colour={multiply(BASE_SKIN, tone.tint)}
            label={fill(text.swatch, { row: text.skin, number: index + 1 })}
            on={draft.skinTone === id}
            onClick={() => set("skinTone", id)}
          />
        ))}
      </Row>

      <Row title={text.hair}>
        {starters(catalog.hairs).map(([id, hair]) => (
          <Choice key={id} on={draft.hair === id} onClick={() => set("hair", id)}>
            {hair.name}
          </Choice>
        ))}
      </Row>

      <Row title={text.hairColour}>
        {starters(catalog.hairColours).map(([id, hairColour], index) => (
          <Swatch
            key={id}
            colour={hairColour.colour}
            label={fill(text.swatch, { row: text.hairColour, number: index + 1 })}
            on={draft.hairColour === id}
            onClick={() => set("hairColour", id)}
          />
        ))}
      </Row>

      <Row title={text.outfit}>
        {starters(catalog.outfits).map(([id, option]) => (
          <Choice key={id} on={draft.outfit === id} onClick={() => set("outfit", id)}>
            {option.name}
          </Choice>
        ))}
      </Row>

      {outfit && outfit.chosen.length > 0 && (
        <Row title={text.outfitColour}>
          {starters(catalog.outfitColours).map(([id, outfitColour], index) => (
            <Swatch
              key={id}
              colour={outfitColour.colour}
              label={fill(text.swatch, { row: text.outfitColour, number: index + 1 })}
              on={draft.outfitColour === id}
              onClick={() => set("outfitColour", id)}
            />
          ))}
        </Row>
      )}

      <div className={styles.creatorFooter}>
        {mode === "change" && (
          <button type="button" className={styles.secondaryAction} onClick={onCancel} disabled={saving}>
            {text.cancel}
          </button>
        )}
        <button type="button" className={styles.action} onClick={onDone} disabled={saving}>
          {saving ? text.saving : text.done}
        </button>
      </div>
    </section>
  );
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.creatorRow} role="group" aria-label={title}>
      <h3>{title}</h3>
      <div className={styles.options}>{children}</div>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={styles.option} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function Swatch({ colour, label, on, onClick }: { colour: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.swatch}
      style={{ background: colour }}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    />
  );
}

/** The free starter options of a catalog section, in the catalog's order. */
function starters<T extends { starter: boolean }>(section: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(section).filter(([, option]) => option.starter);
}
