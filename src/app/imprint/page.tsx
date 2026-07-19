import { Shell } from '@/components/shell';

export const metadata = { title: 'Imprint — ProcureCall' };

export default function ImprintPage() {
  return (
    <Shell>
      <article className="max-w-2xl">
        <p className="text-sm text-steel">Legal</p>
        <h1 className="display mt-2 text-2xl sm:text-3xl">Imprint</h1>
        <p className="mt-3 text-sm text-steel">
          Information according to applicable provider identification requirements.
        </p>

        <section className="mt-8 space-y-6 text-sm text-ink">
          <div>
            <h2 className="font-medium">Service provider</h2>
            <p className="mt-2 text-steel">
              Yannik Trinn
              <br />
              Germany
            </p>
          </div>

          <div>
            <h2 className="font-medium">Contact</h2>
            <p className="mt-2 text-steel">
              For questions about this website or the ProcureCall demo, contact:
              <br />
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
            <h2 className="font-medium">Product</h2>
            <p className="mt-2 text-steel">
              ProcureCall is a public demonstration product. The supplier market shown is
              simulated. No real businesses are contacted through this demo unless a visitor
              explicitly starts a live run under the documented rate limits.
            </p>
          </div>

          <div>
            <h2 className="font-medium">Liability for content</h2>
            <p className="mt-2 text-steel">
              We create the content of these pages with care. We do not guarantee that all
              information is complete, correct, or up to date. Obligations to remove or block
              the use of information under general laws remain unaffected.
            </p>
          </div>

          <div>
            <h2 className="font-medium">Liability for links</h2>
            <p className="mt-2 text-steel">
              Our pages may contain links to external websites. We have no influence on their
              content and accept no liability for them. The respective provider is responsible
              for the linked pages.
            </p>
          </div>
        </section>
      </article>
    </Shell>
  );
}
