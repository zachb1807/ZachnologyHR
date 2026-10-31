import Image from 'next/image';
import { getProfile, isConfigured, METADATA_CLAIM, PHONE_CLAIM } from '@/lib/auth';
export const dynamic = 'force-dynamic';
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : 'Not provided';
const errors: Record<string, string> = {
  configuration: 'Sign-in needs a little setup. Add the Auth0 client secret and session secret to .env.local, then restart the app.',
  state: 'This sign-in request expired or could not be verified. Please try again.',
  denied: 'Sign-in was canceled or access was denied. You can try again below.',
  callback: 'We could not complete sign-in. Please start again.',
  token: 'The sign-in code could not be exchanged. Check the Auth0 client secret and allowed callback URL.',
  userinfo: 'Your profile could not be loaded from the identity provider. Please sign in again.',
  session: 'Your session could not be saved. Check the server session configuration and try again.',
};
function Fields({ rows }: { rows: [string, unknown][] }) {
  return <dl className="fields">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={text(value) === 'Not provided' ? 'empty' : ''}>{text(value)}</dd></div>)}</dl>;
}
export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);
  const error = params.error ? errors[params.error] || errors.callback : null;
  const metadata = profile?.[METADATA_CLAIM];
  const details: Record<string, unknown> = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  const name = profile ? text(profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || profile.nickname || profile.email) : '';
  const initials = name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
  const known = ['city','country','department','employee_id','external_id','postal_address','postal_code','state','street_address','title','user_type'];
  const extra = Object.entries(details).filter(([key]) => !known.includes(key));
  return <div className="shell">
    <header><a className="brand" href="/" aria-label="ZachnologyHR home"><Image className="brand-logo" src="/zachnology-logo.png" alt="Zachnology" width={947} height={488} preload /><span className="brand-hr">HR</span></a><span className="header-label">EMPLOYEE PORTAL</span>{profile && <form action="/auth/logout" method="post"><button className="quiet">Sign out <span aria-hidden>↗</span></button></form>}</header>
    <main>{!profile ? <div className="welcome">
      <section className="welcome-copy"><div className="eyebrow"><span className="dot"/> YOUR PEOPLE. YOUR PLACE.</div><h1>A little more<br/>connected.</h1><p>Your work identity, all in one place. Sign in to view your Zachnology employee profile and directory details.</p><div className="login-area">{error && <div className="notice" role="alert">{error}</div>}{!isConfigured() && !error && <div className="notice">Ready for setup. Add your Auth0 client secret and session secret to .env.local to enable sign-in.</div>}<a className="primary" href="/auth/login">Log in to ZachnologyHR <span aria-hidden>→</span></a><span className="login-note"><span aria-hidden>◇</span> Secure sign-in with your work account</span></div></section>
      <aside className="welcome-art" aria-label="Your directory profile"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-spark">✳</div><div className="preview-card"><span className="mini-label">ZACHNOLOGY / PEOPLE</span><Image className="preview-logo" src="/zachnology-logo.png" alt="Zachnology" width={947} height={488} /><h2>Uniquely you.</h2><p>Part of something bigger.</p><div className="preview-line"/><div className="preview-tags"><span>Work identity</span><span>Directory details</span></div><div className="card-bottom"><span className="dot"/> One connected workplace</div></div><span className="art-caption">GOOD PEOPLE. GREAT POSSIBILITIES.</span></aside>
    </div> : <div className="dashboard">
      <div className="page-heading"><div><div className="eyebrow">YOUR WORKPLACE IDENTITY</div><h1>My profile<span>.</span></h1><p>Your employee information, connected to your work account.</p></div><span className="source-badge"><span className="dot"/> Work account connected</span></div>
      <section className="profile-summary"><div className="avatar">{initials}</div><div><span className="mini-label">ZACHNOLOGY TEAM</span><h2>{name}</h2><p>{[details.title, details.department].filter(v => typeof v === 'string' && v).join(' · ') || 'Employee profile'}</p></div>{typeof details.user_type === 'string' && <span className="employment-badge">{details.user_type}</span>}</section>
      <div className="detail-grid"><section className="detail-card"><div className="section-title"><span>01</span><h2>Contact & identity</h2></div><Fields rows={[["Full name", profile.name], ["First name", profile.given_name], ["Last name", profile.family_name], ["Email address", profile.email], ["Phone number", profile[PHONE_CLAIM]], ["Username", profile.nickname]]}/></section>
      <section className="detail-card"><div className="section-title"><span>02</span><h2>Employment</h2></div><Fields rows={[["Job title", details.title], ["Department", details.department], ["Employee ID", details.employee_id], ["Employment type", details.user_type], ["External ID", details.external_id]]}/></section>
      <section className="detail-card wide"><div className="section-title"><span>03</span><h2>Location</h2></div><Fields rows={[["City", details.city], ["State / region", details.state], ["Country", details.country], ["Street address", details.street_address], ["Postal address", details.postal_address], ["Postal code", details.postal_code]]}/></section>
      {extra.length > 0 && <section className="detail-card wide"><div className="section-title"><span>04</span><h2>Additional directory properties</h2></div><Fields rows={extra.map(([key, value]) => [key.replaceAll('_', ' '), typeof value === 'object' && value !== null ? JSON.stringify(value) : value])}/></section>}</div>
      <p className="profile-note">These details are provided by your organization. Contact your administrator if something needs updating.</p>
      <details className="raw"><summary>View all directory properties</summary><pre>{JSON.stringify(profile, null, 2)}</pre></details>
    </div>}</main>
    <footer><span>© {new Date().getFullYear()} Zachnology</span><span>A place for our people.</span></footer>
  </div>;
}
