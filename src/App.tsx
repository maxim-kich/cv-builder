import { useEffect, useMemo, useRef, useState } from "react";
import { usePDF } from "@react-pdf/renderer";
import { ApiError, createCv, createSession, deleteCv, downloadCvPdf, getRuntimeInfo, listCvs, updateCv, type RuntimeInfo } from "./apiClient";
import { createEmptyResume, type CvDocument } from "./cvStore";
import { outputFilename, resumeToMarkdown } from "./parser";
import { ResumeDocument } from "./pdf/ResumeDocument";
import { PdfPreview } from "./PdfPreview";
import { RichTextEditor } from "./RichTextEditor";
import type { EducationEntry, EmploymentEntry, LanguageEntry, LinkValue, ResumeData } from "./types";

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function RowActions({ index, total, noun, onMove, onDelete }: {
  index: number; total: number; noun: string; onMove: (to: number) => void; onDelete: () => void;
}) {
  return <div className="row-actions">
    <button type="button" className="small-button" disabled={index === 0} onClick={() => onMove(index - 1)}>Move up</button>
    <button type="button" className="small-button" disabled={index === total - 1} onClick={() => onMove(index + 1)}>Move down</button>
    <button type="button" className="small-button danger-button" aria-label={`Delete ${noun}`} onClick={onDelete}>Delete</button>
  </div>;
}

function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string;
}) {
  return <label className="field"><span className="field-label">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="switch-control">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="switch-track" aria-hidden="true"><span /></span>
    <span className="switch-label">{label}</span>
  </label>;
}

function EmploymentCard({ entry, index, total, onChange, onMove, onDelete }: {
  entry: EmploymentEntry; index: number; total: number; onChange: (entry: EmploymentEntry) => void; onMove: (to: number) => void; onDelete: () => void;
}) {
  return <article className="entry-card">
    <header className="entry-card-header"><div><span className="item-number">Position {index + 1}</span><h3>{entry.title || "Untitled position"}</h3></div><RowActions index={index} total={total} noun="position" onMove={onMove} onDelete={onDelete} /></header>
    <div className="field-grid field-grid-three">
      <Field label="Position and company" value={entry.title} placeholder="Product Designer — Company" onChange={(title) => onChange({ ...entry, title })} />
      <Field label="Dates" value={entry.dates} placeholder="January 2024 — Present" onChange={(dates) => onChange({ ...entry, dates })} />
      <Field label="Location" value={entry.location} placeholder="Berlin, Germany" onChange={(location) => onChange({ ...entry, location })} />
    </div>
    <RichTextEditor label="Description" value={entry.description} onChange={(description) => onChange({ ...entry, description })} />
  </article>;
}

function EducationCard({ entry, index, total, onChange, onMove, onDelete }: {
  entry: EducationEntry; index: number; total: number; onChange: (entry: EducationEntry) => void; onMove: (to: number) => void; onDelete: () => void;
}) {
  return <article className="entry-card">
    <header className="entry-card-header"><div><span className="item-number">Education {index + 1}</span><h3>{entry.institution || "Untitled education"}</h3></div><RowActions index={index} total={total} noun="education entry" onMove={onMove} onDelete={onDelete} /></header>
    <div className="field-grid field-grid-three">
      <Field label="Institution" value={entry.institution} onChange={(institution) => onChange({ ...entry, institution })} />
      <Field label="Dates" value={entry.dates} onChange={(dates) => onChange({ ...entry, dates })} />
      <Field label="Location" value={entry.location} onChange={(location) => onChange({ ...entry, location })} />
    </div>
    <div className="field-grid field-grid-two">
      <label className="field"><span className="field-label">Description</span><textarea value={entry.descriptions.join("\n")} onChange={(event) => onChange({ ...entry, descriptions: event.target.value.split("\n").filter(Boolean) })} /></label>
      <label className="field"><span className="field-label">Details (one per line)</span><textarea value={entry.details.join("\n")} onChange={(event) => onChange({ ...entry, details: event.target.value.split("\n").filter(Boolean) })} /></label>
    </div>
  </article>;
}

function LinkRow({ link, index, total, onChange, onDelete }: {
  link: LinkValue; index: number; total: number; onChange: (link: LinkValue) => void; onDelete: () => void;
}) {
  return <div className="compact-row link-row">
    <Field label={`Link ${index + 1} label`} value={link.label} onChange={(label) => onChange({ ...link, label })} />
    <Field label="URL" type="url" value={link.url} onChange={(url) => onChange({ ...link, url })} />
    <button type="button" className="small-button danger-button" disabled={total === 0} onClick={onDelete}>Delete</button>
  </div>;
}

function AppEditor({ resume, onChange, hideLanguageDots, onHideLanguageDotsChange }: {
  resume: ResumeData;
  onChange: (resume: ResumeData) => void;
  hideLanguageDots: boolean;
  onHideLanguageDotsChange: (hide: boolean) => void;
}) {
  const updateEmployment = (index: number, entry: EmploymentEntry) => {
    const employment = [...resume.employment]; employment[index] = entry; onChange({ ...resume, employment });
  };
  const updateSkill = (index: number, value: string) => {
    const skills = [...resume.skills]; skills[index] = value; onChange({ ...resume, skills });
  };
  const updateLanguage = (index: number, value: LanguageEntry) => {
    const languages = [...resume.languages]; languages[index] = value; onChange({ ...resume, languages });
  };
  const updateLink = (index: number, value: LinkValue) => {
    const links = [...resume.contact.links]; links[index] = value; onChange({ ...resume, contact: { ...resume.contact, links } });
  };
  const updateEducation = (index: number, value: EducationEntry) => {
    const education = [...resume.education]; education[index] = value; onChange({ ...resume, education });
  };

  return <div className="form-editor">
    <section className="form-section">
      <div className="section-heading"><div><span>01</span><h2>Basics</h2></div></div>
      <div className="field-grid field-grid-two">
        <Field label="Full name" value={resume.name} onChange={(name) => onChange({ ...resume, name })} />
        <Field label="Professional title" value={resume.professionalTitle} onChange={(professionalTitle) => onChange({ ...resume, professionalTitle })} />
        <Field label="Location" value={resume.contact.address} onChange={(address) => onChange({ ...resume, contact: { ...resume.contact, address } })} />
        <Field label="Email" type="email" value={resume.contact.email.label} onChange={(label) => onChange({ ...resume, contact: { ...resume.contact, email: { label, url: `mailto:${label}` } } })} />
        <Field label="Phone" type="tel" value={resume.contact.phone.label} onChange={(label) => onChange({ ...resume, contact: { ...resume.contact, phone: { label, url: `tel:${label.replace(/[^+\d]/g, "")}` } } })} />
      </div>
      <label className="field"><span className="field-label">Profile</span><textarea value={resume.profile.join("\n\n")} onChange={(event) => onChange({ ...resume, profile: event.target.value.split(/\n\s*\n/).filter(Boolean) })} /></label>
      <div className="subsection-heading"><h3>Links</h3><button type="button" className="secondary-button" onClick={() => onChange({ ...resume, contact: { ...resume.contact, links: [...resume.contact.links, { label: "", url: "https://" }] } })}>Add link</button></div>
      <div className="compact-list">{resume.contact.links.map((link, index) => <LinkRow key={index} link={link} index={index} total={resume.contact.links.length} onChange={(value) => updateLink(index, value)} onDelete={() => onChange({ ...resume, contact: { ...resume.contact, links: resume.contact.links.filter((_, itemIndex) => itemIndex !== index) } })} />)}</div>
    </section>

    <section className="form-section">
      <div className="section-heading"><div><span>02</span><h2>Employment history</h2></div><button type="button" className="secondary-button" onClick={() => onChange({ ...resume, employment: [...resume.employment, { title: "", dates: "", location: "", description: [{ type: "paragraph", spans: [] }] }] })}>Add position</button></div>
      <div className="entry-list">{resume.employment.map((entry, index) => <EmploymentCard key={index} entry={entry} index={index} total={resume.employment.length} onChange={(value) => updateEmployment(index, value)} onMove={(to) => onChange({ ...resume, employment: moveItem(resume.employment, index, to) })} onDelete={() => onChange({ ...resume, employment: resume.employment.filter((_, itemIndex) => itemIndex !== index) })} />)}</div>
    </section>

    <section className="form-section">
      <div className="section-heading"><div><span>03</span><h2>Education</h2></div><button type="button" className="secondary-button" onClick={() => onChange({ ...resume, education: [...resume.education, { institution: "", dates: "", location: "", descriptions: [], details: [] }] })}>Add education</button></div>
      <div className="entry-list">{resume.education.map((entry, index) => <EducationCard key={index} entry={entry} index={index} total={resume.education.length} onChange={(value) => updateEducation(index, value)} onMove={(to) => onChange({ ...resume, education: moveItem(resume.education, index, to) })} onDelete={() => onChange({ ...resume, education: resume.education.filter((_, itemIndex) => itemIndex !== index) })} />)}</div>
    </section>

    <section className="form-section">
      <div className="section-heading"><div><span>04</span><h2>Skills</h2></div><button type="button" className="secondary-button" onClick={() => onChange({ ...resume, skills: [...resume.skills, ""] })}>Add skill</button></div>
      <div className="compact-list">{resume.skills.map((skill, index) => <div className="compact-row" key={index}><label className="field grow"><span className="field-label">Skill {index + 1}</span><input value={skill} onChange={(event) => updateSkill(index, event.target.value)} /></label><RowActions index={index} total={resume.skills.length} noun="skill" onMove={(to) => onChange({ ...resume, skills: moveItem(resume.skills, index, to) })} onDelete={() => onChange({ ...resume, skills: resume.skills.filter((_, itemIndex) => itemIndex !== index) })} /></div>)}</div>
    </section>

    <section className="form-section">
      <div className="section-heading"><div><span>05</span><h2>Languages</h2></div><div className="section-heading-actions"><Toggle label="Without dots" checked={hideLanguageDots} onChange={onHideLanguageDotsChange} /><button type="button" className="secondary-button" onClick={() => onChange({ ...resume, languages: [...resume.languages, { name: "", value: 3, maximum: 5 }] })}>Add language</button></div></div>
      <div className="compact-list">{resume.languages.map((language, index) => <div className="compact-row language-row" key={index}><Field label={`Language ${index + 1}`} value={language.name} onChange={(name) => updateLanguage(index, { ...language, name })} /><label className="field proficiency-field"><span className="field-label">Proficiency</span><select value={language.value} onChange={(event) => updateLanguage(index, { ...language, value: Number(event.target.value), maximum: 5 })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label><RowActions index={index} total={resume.languages.length} noun="language" onMove={(to) => onChange({ ...resume, languages: moveItem(resume.languages, index, to) })} onDelete={() => onChange({ ...resume, languages: resume.languages.filter((_, itemIndex) => itemIndex !== index) })} /></div>)}</div>
    </section>
  </div>;
}

export default function App() {
  const seedResume = useMemo(() => createEmptyResume(), []);
  const [documents, setDocuments] = useState<CvDocument[]>([]);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const savedDrafts = useRef(new Map<string, string>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CvDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [view, setView] = useState<"fields" | "markdown">("fields");
  const [copied, setCopied] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [stopped, setStopped] = useState(false);
  const selectedCv = documents.find((document) => document.id === selectedId) ?? null;
  const resume = selectedCv?.resume ?? seedResume;
  const hideLanguageDots = selectedCv?.hideLanguageDots ?? false;
  const debouncedResume = useDebouncedValue(resume, 250);
  const markdown = useMemo(() => resumeToMarkdown(resume), [resume]);
  const pdfDocument = useMemo(() => <ResumeDocument resume={debouncedResume} showLanguageDots={!hideLanguageDots} />, [debouncedResume, hideLanguageDots]);
  const [instance, updateInstance] = usePDF({ document: pdfDocument });
  useEffect(() => { updateInstance(pdfDocument); }, [pdfDocument, updateInstance]);
  const rememberDocuments = (items: CvDocument[]) => {
    for (const cv of items) savedDrafts.current.set(cv.id, JSON.stringify({ title: cv.title, resume: cv.resume, hideLanguageDots: cv.hideLanguageDots }));
  };
  const refreshDocuments = async () => {
    setLoadError(null);
    try {
      const [info, response] = await Promise.all([getRuntimeInfo(), listCvs()]);
      setRuntime(info);
      rememberDocuments(response.items);
      setDocuments(response.items);
      setNeedsLogin(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setNeedsLogin(true);
      else setLoadError(error instanceof Error ? error.message : "Could not connect to CV Builder");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refreshDocuments();
  }, []);
  const selectedDraft = useMemo(() => selectedCv ? {
    id: selectedCv.id,
    title: selectedCv.title,
    resume: selectedCv.resume,
    hideLanguageDots: selectedCv.hideLanguageDots,
  } : null, [selectedCv?.id, selectedCv?.title, selectedCv?.resume, selectedCv?.hideLanguageDots]);
  const debouncedDraft = useDebouncedValue(selectedDraft, 500);
  useEffect(() => {
    if (!debouncedDraft) return;
    const serialized = JSON.stringify({ title: debouncedDraft.title, resume: debouncedDraft.resume, hideLanguageDots: debouncedDraft.hideLanguageDots });
    if (savedDrafts.current.get(debouncedDraft.id) === serialized) return;
    void updateCv(debouncedDraft.id, debouncedDraft).then((saved) => {
      setLoadError(null);
      savedDrafts.current.set(saved.id, JSON.stringify({ title: saved.title, resume: saved.resume, hideLanguageDots: saved.hideLanguageDots }));
      setDocuments((current) => current.map((cv) => cv.id === saved.id ? { ...cv, updatedAt: saved.updatedAt, revision: saved.revision } : cv));
    }).catch((error) => setLoadError(error instanceof Error ? `Autosave failed: ${error.message}` : "Autosave failed"));
  }, [debouncedDraft]);
  const filename = outputFilename(resume);
  const updateSelected = (changes: Partial<Pick<CvDocument, "title" | "resume" | "hideLanguageDots">>) => {
    if (!selectedId) return;
    setDocuments((current) => current.map((cv) => cv.id === selectedId
      ? { ...cv, ...changes, updatedAt: new Date().toISOString() }
      : cv));
  };
  const createNew = async () => {
    try {
      const cv = await createCv({ title: "Untitled" });
      rememberDocuments([cv]);
      setDocuments((current) => [cv, ...current]);
      setSelectedId(cv.id);
      setView("fields");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not create the CV");
    }
  };
  const downloadCv = async (cv: CvDocument) => {
    if (downloadingId) return;
    setDownloadingId(cv.id);
    try {
      const blob = await downloadCvPdf(cv);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = outputFilename(cv.resume);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloadingId(null);
    }
  };
  const copyMarkdown = async () => { await navigator.clipboard.writeText(markdown); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  const quitServer = async () => {
    if (quitting) return;
    setQuitting(true);
    try {
      const response = await fetch("/api/quit", { method: "POST" });
      if (!response.ok) throw new Error("Quit request failed");
      window.close();
      window.setTimeout(() => setStopped(true), 250);
    } catch {
      setQuitting(false);
      window.alert("CV Builder could not stop the server. Restart it once to load the quit endpoint.");
    }
  };

  if (loading) return <main className="status-screen"><img src="/favicon.svg" alt="" /><h1>Opening CV Builder…</h1></main>;
  if (needsLogin) return <LoginScreen error={loadError} onLogin={async (token) => {
    await createSession(token);
    setLoading(true);
    await refreshDocuments();
  }} />;
  if (loadError && documents.length === 0) return <main className="status-screen"><img src="/favicon.svg" alt="" /><h1>CV Builder is unavailable</h1><p>{loadError}</p><button type="button" className="secondary-button" onClick={() => { setLoading(true); void refreshDocuments(); }}>Try again</button></main>;

  if (stopped) {
    return <main className="quit-screen"><img src="/favicon.svg" alt="" /><h1>CV Builder stopped</h1><p>You can close this tab. Reopen CV Builder.app to start it again.</p></main>;
  }

  return <main className="studio-shell">
    <header className="topbar">
      <div className="brand">
        <h1 className="brand-title">
          <span className="brand-ascii-logo" aria-hidden="true">{` ██████╗██╗   ██╗    ██████╗ ██╗   ██╗██╗██╗     ██████╗ ███████╗██████╗
██╔════╝██║   ██║    ██╔══██╗██║   ██║██║██║     ██╔══██╗██╔════╝██╔══██╗
██║     ██║   ██║    ██████╔╝██║   ██║██║██║     ██║  ██║█████╗  ██████╔╝
██║     ╚██╗ ██╔╝    ██╔══██╗██║   ██║██║██║     ██║  ██║██╔══╝  ██╔══██╗
╚██████╗ ╚████╔╝     ██████╔╝╚██████╔╝██║███████╗██████╔╝███████╗██║  ██║
 ╚═════╝  ╚═══╝      ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝`}</span>
          <span className="sr-only">CV Builder</span>
        </h1>
      </div>
      <div className="topbar-actions">
        {loadError ? <span className="save-error" role="status">{loadError}</span> : null}
        {runtime?.canQuit ? <button type="button" className={`quit-button${quitting ? " quitting" : ""}`} title={quitting ? "Stopping CV Builder" : "Quit CV Builder"} aria-label={quitting ? "Stopping CV Builder" : "Quit CV Builder"} disabled={quitting} onClick={quitServer}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v9"/><path d="M6.1 7.8a8 8 0 1 0 11.8 0"/></svg></button> : null}
      </div>
    </header>
    {selectedCv ? <>
      <section className="document-toolbar" aria-label="CV controls">
        <button type="button" className="text-button" onClick={() => setSelectedId(null)}>Back</button>
        <label className="document-name"><span className="sr-only">CV name</span><input value={selectedCv.title} aria-label="CV name" onChange={(event) => updateSelected({ title: event.target.value })} /></label>
        {instance.url ? <a className="download-button" href={instance.url} download={filename}>Download CV</a> : <button className="download-button" disabled>Rendering PDF…</button>}
      </section>
      <section className="workspace" aria-label="Résumé editing workspace">
      <article className="panel editor-panel">
        <header className="panel-header editor-header"><div className="view-tabs" role="tablist" aria-label="Editor view"><button type="button" role="tab" aria-selected={view === "fields"} onClick={() => setView("fields")}>Fields</button><button type="button" role="tab" aria-selected={view === "markdown"} onClick={() => setView("markdown")}>Markdown</button></div>{view === "markdown" ? <button type="button" className="small-button" onClick={copyMarkdown}>{copied ? "Copied" : "Copy Markdown"}</button> : <span>{resume.employment.length} positions</span>}</header>
        {view === "fields" ? <AppEditor resume={resume} onChange={(next) => updateSelected({ resume: next })} hideLanguageDots={hideLanguageDots} onHideLanguageDotsChange={(hide) => updateSelected({ hideLanguageDots: hide })} /> : <div className="markdown-view"><p>Markdown is generated from the fields and stays read-only.</p><pre>{markdown}</pre></div>}
      </article>
      <article className="panel preview-panel"><header className="panel-header"><div><h2>Live PDF preview</h2></div><span>{filename}</span></header><PdfPreview url={instance.url} /></article>
      </section>
    </> : <CvGallery documents={documents} downloadingId={downloadingId} onCreate={() => void createNew()} onOpen={(id) => { setSelectedId(id); setView("fields"); }} onDownload={downloadCv} onDelete={setDeleteTarget} />}
    {deleteTarget ? <DeleteCvModal cv={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => {
      void deleteCv(deleteTarget.id).then(() => {
        savedDrafts.current.delete(deleteTarget.id);
        setDocuments((current) => current.filter((cv) => cv.id !== deleteTarget.id));
        setDeleteTarget(null);
      }).catch((error) => setLoadError(error instanceof Error ? error.message : "Could not delete the CV"));
    }} /> : null}
  </main>;
}

function LoginScreen({ error, onLogin }: { error: string | null; onLogin: (token: string) => Promise<void> }) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(error);
  return <main className="login-screen">
    <form className="login-card" onSubmit={(event) => {
      event.preventDefault();
      setSubmitting(true);
      setLoginError(null);
      void onLogin(token).catch((loginFailure) => {
        setLoginError(loginFailure instanceof ApiError && loginFailure.status === 401
          ? "That access token is not valid. Check the server’s CV_BUILDER_API_TOKEN and try again."
          : loginFailure instanceof Error ? loginFailure.message : "CV Builder could not sign in. Try again.");
        setSubmitting(false);
      });
    }}>
      <img src="/favicon.svg" alt="" />
      <p className="eyebrow">Private workspace</p>
      <h1>Open CV Builder</h1>
      <p>Enter the access token configured on this server.</p>
      <label className="field"><span className="field-label">Access token</span><input type="password" autoComplete="current-password" autoFocus aria-invalid={Boolean(loginError)} aria-describedby={loginError ? "login-error" : undefined} value={token} onChange={(event) => setToken(event.target.value)} /></label>
      {loginError ? <p id="login-error" className="login-error" role="alert">{loginError}</p> : null}
      <button type="submit" className="download-button" aria-busy={submitting} disabled={!token || submitting}>Open workspace</button>
    </form>
  </main>;
}

function CvGallery({ documents, downloadingId, onCreate, onOpen, onDownload, onDelete }: {
  documents: CvDocument[];
  downloadingId: string | null;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onDownload: (cv: CvDocument) => void;
  onDelete: (cv: CvDocument) => void;
}) {
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }), []);
  return <section className="gallery-shell" aria-labelledby="gallery-title">
    <header className="gallery-heading"><h2 id="gallery-title">List</h2><button type="button" className="secondary-button create-button" onClick={onCreate}>Create new</button></header>
    {documents.length ? <div className="cv-list">{documents.map((cv) => <article key={cv.id} className="cv-list-row" tabIndex={0} role="button" aria-label={`Edit ${cv.title || "Untitled"}`} onClick={() => onOpen(cv.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(cv.id); } }}>
      <div className="cv-list-copy"><h3>{cv.title || "Untitled"}</h3><p>Edited {dateFormatter.format(new Date(cv.updatedAt))}</p></div>
      <div className="cv-list-actions">
        <button type="button" className="emoji-button" title="Download CV" aria-label={`Download ${cv.title || "Untitled"}`} disabled={downloadingId === cv.id} onClick={(event) => { event.stopPropagation(); void onDownload(cv); }}>📥</button>
        <button type="button" className="emoji-button delete-emoji-button" title="Delete CV" aria-label={`Delete ${cv.title || "Untitled"}`} onClick={(event) => { event.stopPropagation(); onDelete(cv); }}>🗑️</button>
      </div>
    </article>)}</div> : <div className="empty-gallery"><h3>No CVs yet</h3><p>Create your first CV to get started.</p></div>}
  </section>;
}

function DeleteCvModal({ cv, onCancel, onConfirm }: { cv: CvDocument; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" aria-describedby="delete-modal-description">
      <p className="eyebrow">Delete CV</p>
      <h2 id="delete-modal-title">Delete “{cv.title || "Untitled"}”?</h2>
      <p id="delete-modal-description">This removes the CV from shared storage. This action cannot be undone.</p>
      <div className="modal-actions"><button ref={cancelRef} type="button" className="small-button" onClick={onCancel}>Cancel</button><button type="button" className="small-button modal-delete-button" onClick={onConfirm}>Delete</button></div>
    </section>
  </div>;
}
