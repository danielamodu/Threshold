/**
 * Signal Cabinet style reminder: the contact flow should be a clear operating handoff, not a generic lead form.
 * Ask only for useful context and state that submission opens an email draft rather than silently storing data.
 */
import { type FormEvent, useState } from "react";
import { ArrowUpRight, Mail } from "lucide-react";

export function ContactFlow() {
  const [interest, setInterest] = useState("Both driver and cargo risk");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get("name") || "";
    const email = form.get("email") || "";
    const cargo = form.get("cargo") || "";
    const size = form.get("size") || "";
    const note = form.get("note") || "";
    const subject = `Threshold field brief — ${name || "new inquiry"}`;
    const body = [
      "Hi Threshold,",
      "",
      "I would like to talk about Threshold.",
      "",
      `Name: ${name}`,
      `Work email: ${email}`,
      `Main need: ${interest}`,
      `Cargo type: ${cargo}`,
      `Fleet or program size: ${size}`,
      `Anything else: ${note}`,
    ].join("\n");
    window.location.href = `mailto:hello@threshold.systems?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <section className="contact-flow" id="contact" aria-labelledby="contact-heading">
      <div className="landing-container contact-flow__shell">
        <div className="contact-flow__intro">
          <p className="eyebrow">Start a field brief</p>
          <h2 id="contact-heading">Tell us what needs to be clearer on your route.</h2>
          <p>Answer a few simple questions. We’ll open a pre-filled email so you can review it before sending.</p>
          <div className="contact-flow__note"><Mail size={15} /><span>No account, sales script, or automatic submission.</span></div>
        </div>

        <form className="contact-form" onSubmit={handleSubmit}>
          <div className="contact-form__row"><label><span>Your name</span><input name="name" autoComplete="name" placeholder="Name" required /></label><label><span>Work email</span><input name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label></div>
          <fieldset><legend>What do you need help with?</legend><div className="contact-choice-grid">{["Both driver and cargo risk", "Driver heat risk", "Cargo temperature risk", "Something else"].map((option) => <label key={option} className={interest === option ? "contact-choice contact-choice--active" : "contact-choice"}><input type="radio" name="interest" value={option} checked={interest === option} onChange={() => setInterest(option)} /><span>{option}</span></label>)}</div></fieldset>
          <div className="contact-form__row"><label><span>What do you move?</span><select name="cargo" defaultValue="Pharma"><option>Pharma</option><option>Food and beverage</option><option>Other temperature-sensitive cargo</option><option>Not sure yet</option></select></label><label><span>Rough fleet or program size</span><select name="size" defaultValue="1–20 vehicles"><option>1–20 vehicles</option><option>21–100 vehicles</option><option>101–500 vehicles</option><option>500+ vehicles</option><option>Not sure yet</option></select></label></div>
          <label><span>Anything else we should know? <em>Optional</em></span><textarea name="note" rows={3} placeholder="Tell us what is happening today." /></label>
          <button type="submit" className="contact-form__submit">Create my email draft <ArrowUpRight size={17} /></button>
        </form>
      </div>
    </section>
  );
}
