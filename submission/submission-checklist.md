# Submission checklist

## Product (verify in incognito on https://procurecall.vercel.app)

- [ ] `/` loads; CTAs work
- [ ] `/request`: typed intake builds a draft; document upload builds a draft; voice
      interview connects, interviews, and lands on the same confirm screen
- [ ] Confirm screen: required-field validation, lever authorization, confirm freezes
      spec and shows fingerprint; later edit creates v2
- [ ] `/board/{spec}`: three calls run; fee pins land live; leverage connector draws;
      every call ends in a structured outcome
- [ ] `/decision/{spec}`: recommendation + evidence rail; every figure links to its
      transcript moment; flags in plain words
- [ ] `/demo`: replay plays and is labeled; live run respects rate limits; reset
      removes visitor data only
- [ ] `/lab`: adversarial results show the real latest numbers
- [ ] Voice negotiation: one roleplay call works end to end with recording playback

## Engineering

- [ ] `pnpm lint` clean · `pnpm typecheck` clean · `pnpm test` green ·
      `pnpm test:e2e` green · `pnpm build` passes
- [ ] CI green on main
- [ ] No secret committed (`git log -p | grep -i` spot checks; `.env*` ignored)
- [ ] RLS deny-all verified (anon select returns `[]`, insert 42501)

## Package

- [ ] `submission/project-summary.md` word count 150–300
- [ ] Three videos recorded, each ≤ 60 s; claims match live functionality
- [ ] `architecture.svg` renders on GitHub
- [ ] `/data` complete per `dataset-manifest.md` (incl. exported eval results)
- [ ] README follows the required order, screenshot current
- [ ] Repository public at https://github.com/yatrinn/procurecall
- [ ] Zip created from the final commit (`git archive`)
- [ ] Production URL + repo + zip + videos + dataset entered in the submission form
