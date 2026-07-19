import { Shell } from '@/components/shell';

export const metadata = { title: 'Privacy | ProcureCall' };

export default function PrivacyPage() {
  return (
    <Shell>
      <article className="max-w-2xl">
        <p className="text-sm text-steel">Legal</p>
        <h1 className="display mt-2 text-2xl sm:text-3xl">Privacy</h1>
        <p className="mt-3 text-sm text-steel">
          How ProcureCall handles information when you use the public demo.
        </p>

        <section className="mt-8 space-y-6 text-sm text-ink">
          <div>
            <h2 className="font-medium">Controller</h2>
            <p className="mt-2 text-steel">
              Yannik Trinn
              <br />
              Contact:{' '}
              <a
                href="https://github.com/yatrinn"
                className="text-ink underline underline-offset-4 hover:text-steel"
                rel="noopener noreferrer"
                target="_blank"
              >
                github.com/yatrinn
              </a>
            </p>
          </div>

          <div>
            <h2 className="font-medium">What this site is</h2>
            <p className="mt-2 text-steel">
              ProcureCall is a demonstration product. There is no account registration and no
              login. The default demo market is simulated.
            </p>
          </div>

          <div>
            <h2 className="font-medium">Data we process</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-steel">
              <li>
                <span className="text-ink">Request content you enter:</span> text, uploads, or
                voice notes you submit when starting a request. Used only to run the demo
                workflow (structuring the brief, simulated or live negotiation runs).
              </li>
              <li>
                <span className="text-ink">Technical logs:</span> standard hosting and server
                logs (e.g. IP address, time, requested URL) needed to operate, secure, and rate-
                limit the service.
              </li>
              <li>
                <span className="text-ink">Call session data:</span> if you start a live or voice
                run, transcripts, tool events, and (where applicable) recordings are stored so
                the board and decision room can show evidence.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="font-medium">Cookies and analytics</h2>
            <p className="mt-2 text-steel">
              We do not use advertising cookies or third-party marketing analytics on this demo.
              Essential hosting and security mechanisms from our infrastructure providers may
              process technical data as needed to deliver the site.
            </p>
          </div>

          <div>
            <h2 className="font-medium">Processors</h2>
            <p className="mt-2 text-steel">
              Depending on the feature you use, processing may involve infrastructure and model
              providers (for example hosting, database, speech, and language-model APIs) acting
              on our behalf to run the demo.
            </p>
          </div>

          <div>
            <h2 className="font-medium">Retention</h2>
            <p className="mt-2 text-steel">
              Demo runs and related artifacts are kept only as long as needed to operate and
              demonstrate the product, then removed or overwritten in the normal course of
              maintenance. You can ask us to delete a specific run you created.
            </p>
          </div>

          <div>
            <h2 className="font-medium">Your rights</h2>
            <p className="mt-2 text-steel">
              Depending on applicable law, you may have rights to access, correct, delete, or
              restrict processing of personal data, and to lodge a complaint with a supervisory
              authority. Contact us via the channel above to exercise these rights.
            </p>
          </div>

          <div>
            <h2 className="font-medium">Updates</h2>
            <p className="mt-2 text-steel">
              We may update this notice when the demo changes. The current version is always
              published on this page.
            </p>
          </div>
        </section>
      </article>
    </Shell>
  );
}
