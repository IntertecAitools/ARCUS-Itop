import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui';
import { useLookup, useProfiles } from '../api/users.api';
import type { Option } from '../types';

/** iTop adds this one itself for staff; it is not a choice an admin makes. */
const AUTOMATIC_PROFILE = 'REST Services User';

/**
 * The profiles an account holds -- what it may do. "Portal user" makes it an
 * end-user account; every other profile is staff.
 */
export function ProfilePicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { data: profiles, isLoading } = useProfiles();
  if (isLoading) return <p className="text-[13px] text-ink-muted">Loading profiles…</p>;

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {(profiles ?? [])
        .filter((p) => p.name !== AUTOMATIC_PROFILE)
        .map((profile) => (
          <label key={profile.id} className="flex items-start gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={value.includes(profile.id)}
              // A customer's administrator cannot give or take away Administrator:
              // the platform operator does (the BFF refuses it too).
              disabled={profile.grantable === false}
              aria-describedby={profile.grantable === false ? `profile-${profile.id}-locked` : undefined}
              onChange={() =>
                onChange(value.includes(profile.id) ? value.filter((id) => id !== profile.id) : [...value, profile.id])
              }
            />
            <span>
              <span className="font-medium">{profile.name}</span>
              {profile.description ? <span className="block text-[12px] text-ink-muted">{profile.description}</span> : null}
              {profile.grantable === false ? (
                <span id={`profile-${profile.id}-locked`} className="block text-[12px] text-ink-muted">
                  Granted by the platform operator only.
                </span>
              ) : null}
            </span>
          </label>
        ))}
    </div>
  );
}

/** Search-and-pick, for one record (`single`) or several. */
export function RecordPicker({
  className,
  value,
  onChange,
  single,
  placeholder,
}: {
  className: 'Person' | 'Organization';
  value: Option[];
  onChange: (value: Option[]) => void;
  single?: boolean;
  placeholder: string;
}) {
  const [q, setQ] = useState('');
  const { data: options, isFetching } = useLookup(className, q.trim());
  const chosen = new Set(value.map((v) => v.id));

  return (
    <div>
      {value.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-control bg-surface-hover px-2 py-0.5 text-[12px] text-ink">
              {v.label}
              <button type="button" aria-label={`Remove ${v.label}`} onClick={() => onChange(value.filter((x) => x.id !== v.id))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {single && value.length > 0 ? null : (
        <>
          <Input placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim() ? (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-card border border-line">
              {isFetching && !options ? (
                <li className="px-2 py-1.5 text-[13px] text-ink-muted">Searching…</li>
              ) : (options ?? []).filter((o) => !chosen.has(o.id)).length === 0 ? (
                <li className="px-2 py-1.5 text-[13px] text-ink-muted">No match.</li>
              ) : (
                (options ?? [])
                  .filter((o) => !chosen.has(o.id))
                  .map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-start text-[13px] text-ink hover:bg-surface-hover"
                        onClick={() => {
                          onChange(single ? [o] : [...value, o]);
                          setQ('');
                        }}
                      >
                        {o.label}
                      </button>
                    </li>
                  ))
              )}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
