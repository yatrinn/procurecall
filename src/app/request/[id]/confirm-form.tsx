'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeverDef, SpecField } from '@/config/vertical-schema';
import { Field, inputClass, monoInputClass, PrimaryButton, QuietButton } from '@/components/form';

interface TimeWindow {
  earliest: string | null;
  latest: string | null;
}

type FieldValue = string | number | boolean | string[] | TimeWindow | null;

export interface SpecDto {
  id: string;
  vertical_slug: string;
  spec: { fields: Record<string, FieldValue> };
  spec_version: number;
  authorized_levers: Record<string, boolean | number | null>;
  confirmed_by_user: boolean;
  confirmed_at: string | null;
  spec_fingerprint: string | null;
  intake_source: string;
}

export function ConfirmForm({
  spec,
  specFields,
  levers,
  currencyLabel,
}: {
  spec: SpecDto;
  specFields: SpecField[];
  levers: LeverDef[];
  currencyLabel: string;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Record<string, FieldValue>>(spec.spec.fields);
  const [leverState, setLeverState] = useState<Record<string, boolean | number | null>>(
    spec.authorized_levers,
  );
  const [editing, setEditing] = useState(!spec.confirmed_by_user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const missingRequired = useMemo(
    () =>
      specFields.filter((f) => {
        if (!f.required) return false;
        const v = fields[f.id];
        return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
      }),
    [specFields, fields],
  );

  const setField = useCallback((id: string, value: FieldValue) => {
    setFields((prev) => ({ ...prev, [id]: value }));
  }, []);

  const save = useCallback(async (): Promise<SpecDto | null> => {
    const res = await fetch(`/api/specs/${spec.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, authorized_levers: leverState }),
    });
    const body = (await res.json()) as SpecDto & { error?: string };
    if (!res.ok) {
      setError(body.error ?? 'Saving failed.');
      return null;
    }
    return body;
  }, [spec.id, fields, leverState]);

  const confirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    setIssues({});
    const saved = await save();
    if (!saved) {
      setBusy(false);
      return;
    }
    const res = await fetch(`/api/specs/${saved.id}/confirm`, { method: 'POST' });
    const body = (await res.json()) as {
      error?: string;
      issues?: Array<{ path: string; message: string }>;
      spec_fingerprint?: string;
    };
    if (!res.ok) {
      if (body.issues) {
        const map: Record<string, string> = {};
        for (const issue of body.issues) {
          const key = issue.path.replace(/^fields\.?/, '').split('.')[0];
          if (key) map[key] = issue.message;
        }
        setIssues(map);
        setError('Some required fields are missing or invalid. They are marked below.');
      } else {
        setError(body.error ?? 'Confirmation failed.');
      }
      setBusy(false);
      return;
    }
    if (saved.id !== spec.id) {
      router.push(`/request/${saved.id}`);
    } else {
      router.refresh();
    }
    setBusy(false);
    setEditing(false);
  }, [save, spec.id, router]);

  const startEdit = useCallback(() => setEditing(true), []);

  const saveNewVersion = useCallback(async () => {
    setBusy(true);
    setError(null);
    const saved = await save();
    setBusy(false);
    if (saved && saved.id !== spec.id) {
      router.push(`/request/${saved.id}`);
    } else if (saved) {
      router.refresh();
      setEditing(false);
    }
  }, [save, spec.id, router]);

  const disabled = !editing || busy;

  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {specFields.map((f) => (
            <FieldEditor
              key={f.id}
              field={f}
              value={fields[f.id] ?? null}
              onChange={(v) => setField(f.id, v)}
              disabled={disabled}
              error={issues[f.id]}
            />
          ))}
        </div>

        <h2 className="mt-10 border-t border-line pt-6 text-sm font-medium">
          What the agent may do on your behalf
        </h2>
        <p className="mt-1 max-w-xl text-sm text-steel">
          Unauthorized levers are not merely discouraged. The agent does not receive the
          corresponding capability at all.
        </p>
        <div className="mt-4 space-y-3">
          {levers.map((lever) => (
            <label key={lever.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={Boolean(leverState[lever.id])}
                onChange={(e) =>
                  setLeverState((prev) => ({ ...prev, [lever.id]: e.target.checked }))
                }
                disabled={disabled}
                className="mt-1 h-4 w-4 accent-ink"
              />
              <span>
                <span className="block text-sm">{lever.label}</span>
                <span className="block text-xs text-steel">{lever.description}</span>
              </span>
            </label>
          ))}
          {leverState.may_commit_immediately ? (
            <div className="ml-7 max-w-xs">
              <Field label={`Maximum commitment (net, ${currencyLabel})`}>
                <input
                  type="number"
                  min={0}
                  className={monoInputClass}
                  value={(leverState.maximum_commitment_net as number | null) ?? ''}
                  onChange={(e) =>
                    setLeverState((prev) => ({
                      ...prev,
                      maximum_commitment_net: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  disabled={disabled}
                />
              </Field>
            </div>
          ) : null}
        </div>

        {error ? <p className="mt-6 text-sm text-flag">{error}</p> : null}

        <div className="mt-8 flex items-center gap-3">
          {!spec.confirmed_by_user ? (
            <>
              <PrimaryButton onClick={confirm} disabled={busy}>
                {busy ? 'Confirming…' : 'Confirm request'}
              </PrimaryButton>
              <span className="text-sm text-steel">
                Confirming freezes this request and computes its fingerprint.
              </span>
            </>
          ) : editing ? (
            <>
              <PrimaryButton onClick={saveNewVersion} disabled={busy}>
                {busy ? 'Saving…' : 'Save as new version'}
              </PrimaryButton>
              <QuietButton onClick={() => setEditing(false)} disabled={busy}>
                Discard changes
              </QuietButton>
            </>
          ) : (
            <QuietButton onClick={startEdit}>Edit (creates a new version)</QuietButton>
          )}
        </div>
      </div>

      <aside>
        <div className="border border-line bg-paper p-4">
          <h2 className="text-sm font-medium">Request status</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-steel">Version</dt>
              <dd className="figure">v{spec.spec_version}</dd>
            </div>
            <div>
              <dt className="text-steel">Intake source</dt>
              <dd>{spec.intake_source}</dd>
            </div>
            <div>
              <dt className="text-steel">Fingerprint</dt>
              <dd>
                {spec.confirmed_by_user && spec.spec_fingerprint ? (
                  <span className="figure break-all text-verified" title={spec.spec_fingerprint}>
                    {spec.spec_fingerprint.slice(0, 12)}
                  </span>
                ) : (
                  <span className="text-steel">(computed on confirmation)</span>
                )}
              </dd>
            </div>
            {!spec.confirmed_by_user ? (
              <div>
                <dt className="text-steel">Missing required fields</dt>
                <dd className={missingRequired.length ? 'text-flag' : ''}>
                  {missingRequired.length === 0
                    ? 'None'
                    : missingRequired.map((f) => f.label).join(', ')}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
        {spec.confirmed_by_user ? (
          <>
            <a
              href={`/board/${spec.id}`}
              className="mt-4 block rounded-sm bg-ink px-4 py-2 text-center text-sm font-medium text-paper hover:bg-black"
            >
              Go to the negotiation board
            </a>
            <p className="mt-3 text-xs text-steel">
              This request is frozen. Every call cites this exact fingerprint; any edit creates a
              new version with a new fingerprint.
            </p>
          </>
        ) : (
          <p className="mt-3 text-xs text-steel">
            No supplier is called before you confirm.
          </p>
        )}
      </aside>
    </div>
  );
}

function FieldEditor({
  field,
  value,
  onChange,
  disabled,
  error,
}: {
  field: SpecField;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  disabled: boolean;
  error?: string;
}) {
  const label = field.required ? field.label : `${field.label} (optional)`;
  switch (field.type) {
    case 'text':
      return (
        <Field label={label} hint={field.hint} error={error}>
          <input
            type="text"
            className={inputClass}
            value={(value as string | null) ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
          />
        </Field>
      );
    case 'number':
      return (
        <Field label={field.unit ? `${label} (${field.unit})` : label} hint={field.hint} error={error}>
          <input
            type="number"
            className={monoInputClass}
            value={(value as number | null) ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            disabled={disabled}
          />
        </Field>
      );
    case 'boolean':
      return (
        <Field label={label} hint={field.hint} error={error}>
          <select
            className={inputClass}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}
            disabled={disabled}
          >
            <option value="">-</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Field>
      );
    case 'date':
      return (
        <Field label={label} hint={field.hint} error={error}>
          <input
            type="date"
            className={monoInputClass}
            value={(value as string | null) ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
          />
        </Field>
      );
    case 'time_window': {
      const w = (value as TimeWindow | null) ?? { earliest: null, latest: null };
      return (
        <Field label={label} hint={field.hint ?? 'Earliest / latest'} error={error}>
          <div className="flex items-center gap-2">
            <input
              type="time"
              className={monoInputClass}
              value={w.earliest ?? ''}
              onChange={(e) =>
                onChange({ earliest: e.target.value || null, latest: w.latest })
              }
              disabled={disabled}
              aria-label={`${field.label} earliest`}
            />
            <span className="text-steel">–</span>
            <input
              type="time"
              className={monoInputClass}
              value={w.latest ?? ''}
              onChange={(e) =>
                onChange({ earliest: w.earliest, latest: e.target.value || null })
              }
              disabled={disabled}
              aria-label={`${field.label} latest`}
            />
          </div>
        </Field>
      );
    }
    case 'select':
      return (
        <Field label={label} hint={field.hint} error={error}>
          <select
            className={inputClass}
            value={(value as string | null) ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
          >
            <option value="">-</option>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
      );
    case 'multiselect': {
      const selected = (value as string[] | null) ?? [];
      return (
        <Field label={label} hint={field.hint} error={error}>
          <div className="flex flex-wrap gap-2">
            {(field.options ?? []).map((o) => {
              const active = selected.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() =>
                    onChange(active ? selected.filter((x) => x !== o) : [...selected, o])
                  }
                  disabled={disabled}
                  aria-pressed={active}
                  className={`rounded-sm border px-2 py-1 text-xs ${
                    active
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line bg-paper text-steel hover:border-steel'
                  }`}
                >
                  {o.replaceAll('_', ' ')}
                </button>
              );
            })}
          </div>
        </Field>
      );
    }
  }
}
