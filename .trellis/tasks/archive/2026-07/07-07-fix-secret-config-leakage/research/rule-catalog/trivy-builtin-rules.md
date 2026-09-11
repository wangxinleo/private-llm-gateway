[Skip to content](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go#start-of-content)

You signed in with another tab or window. [Reload](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go) to refresh your session.You signed out in another tab or window. [Reload](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go) to refresh your session.You switched accounts on another tab or window. [Reload](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go) to refresh your session.Dismiss alert

{{ message }}

### Uh oh!

There was an error while loading. [Please reload this page](https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go).

[aquasecurity](https://github.com/aquasecurity)/ **[trivy](https://github.com/aquasecurity/trivy)** Public

- [Notifications](https://github.com/login?return_to=%2Faquasecurity%2Ftrivy) You must be signed in to change notification settings
- [Fork\\
519](https://github.com/login?return_to=%2Faquasecurity%2Ftrivy)
- [Star\\
36.8k](https://github.com/login?return_to=%2Faquasecurity%2Ftrivy)


## Collapse file tree

## Files

main

Search this repository(forward slash)` forward slash/`

/

# builtin-rules.go

Copy path

Blame

More file actions

Blame

More file actions

## Latest commit

![nikpivkin](https://avatars.githubusercontent.com/u/100182843?v=4&size=40)![ChrisJr404](https://avatars.githubusercontent.com/u/11917633?v=4&size=40)![DmitriyLewen](https://avatars.githubusercontent.com/u/91113035?v=4&size=40)
3 people

[feat(secret): support new stateless format for GitHub App installatio…](https://github.com/aquasecurity/trivy/commit/e68f3d2d3476b59c57de2ef2c2806edb001147ee)

Open commit detailssuccess

3 weeks agoJun 16, 2026

[e68f3d2](https://github.com/aquasecurity/trivy/commit/e68f3d2d3476b59c57de2ef2c2806edb001147ee) · 3 weeks agoJun 16, 2026

## History

[History](https://github.com/aquasecurity/trivy/commits/main/pkg/fanal/secret/builtin-rules.go)

Open commit details

[View commit history for this file.](https://github.com/aquasecurity/trivy/commits/main/pkg/fanal/secret/builtin-rules.go) History

1065 lines (1057 loc) · 40.7 KB

·

/

# builtin-rules.go

Copy path

Top

## File metadata and controls

- Code

- Blame


1065 lines (1057 loc) · 40.7 KB

·

[Raw](https://github.com/aquasecurity/trivy/raw/refs/heads/main/pkg/fanal/secret/builtin-rules.go)

Copy raw file

Download raw file

You must be signed in to make or propose changes

More edit options

Open symbols panel

Edit and raw actions

1

2

3

4

5

6

7

8

9

10

11

12

13

14

15

16

17

18

19

20

21

22

23

24

25

26

27

28

29

30

31

32

33

34

35

36

37

38

39

40

41

42

43

44

45

46

47

48

49

50

51

52

53

54

55

56

57

58

59

60

61

62

63

64

65

66

67

68

69

70

71

72

73

74

75

76

77

78

79

80

81

82

83

84

85

86

87

88

89

90

91

92

93

94

95

96

97

98

99

100

101

102

103

104

105

106

107

108

109

110

111

112

113

114

115

116

117

118

119

120

121

122

123

124

125

126

127

128

129

130

131

132

133

134

135

136

137

138

139

140

141

142

143

144

145

146

147

148

149

150

151

152

153

154

155

156

157

158

159

160

161

162

163

164

165

166

167

168

169

170

171

172

173

174

175

176

177

178

179

180

181

182

183

184

185

186

187

188

189

190

191

192

193

194

195

196

197

198

199

200

201

202

203

204

205

206

207

208

209

210

211

212

213

214

215

216

217

218

219

220

221

222

223

224

225

226

227

228

229

230

231

232

233

234

235

236

237

238

239

240

241

242

243

244

245

246

247

248

249

250

251

252

253

254

255

256

257

258

259

260

261

262

263

264

265

266

267

268

269

270

271

272

273

274

275

276

277

278

279

280

281

282

283

284

285

286

287

288

289

290

291

292

293

294

295

296

297

298

299

300

301

302

303

304

305

306

307

308

309

310

311

312

313

314

315

316

317

318

319

320

321

322

323

324

325

326

327

328

329

330

331

332

333

334

335

336

337

338

339

340

341

342

343

344

345

346

347

348

349

350

351

352

353

354

355

356

357

358

359

360

361

362

363

364

365

366

367

368

369

370

371

372

373

374

375

376

377

378

379

380

381

382

383

384

385

386

387

388

389

390

391

392

393

394

395

396

397

398

399

400

401

402

403

404

405

406

407

408

409

410

411

412

413

414

415

416

417

418

419

420

421

422

423

424

425

426

427

428

429

430

431

432

433

434

435

436

437

438

439

440

441

442

443

444

445

446

447

448

449

450

451

452

453

454

455

456

457

458

459

460

461

462

463

464

465

466

467

468

469

470

471

472

473

474

475

476

477

478

479

480

481

482

483

484

485

486

487

488

489

490

491

492

493

494

495

496

497

498

499

500

501

502

503

504

505

506

507

508

509

510

511

512

513

514

515

516

517

518

519

520

521

522

523

524

525

526

527

528

529

530

531

532

533

534

535

536

537

538

539

540

541

542

543

544

545

546

547

548

549

550

551

552

553

554

555

556

557

558

559

560

561

562

563

564

565

566

567

568

569

570

571

572

573

574

575

576

577

578

579

580

581

582

583

584

585

586

587

588

589

590

591

592

593

594

595

596

597

598

599

600

601

602

603

604

605

606

607

608

609

610

611

612

613

614

615

616

617

618

619

620

621

622

623

624

625

626

627

628

629

630

631

632

633

634

635

636

637

638

639

640

641

642

643

644

645

646

647

648

649

650

651

652

653

654

655

656

657

658

659

660

661

662

663

664

665

666

667

668

669

670

671

672

673

674

675

676

677

678

679

680

681

682

683

684

685

686

687

688

689

690

691

692

693

694

695

696

697

698

699

700

701

702

703

704

705

706

707

708

709

710

711

712

713

714

715

716

717

718

719

720

721

722

723

724

725

726

727

728

729

730

731

732

733

734

735

736

737

738

739

740

741

742

743

744

745

746

747

748

749

750

751

752

753

754

755

756

757

758

759

760

761

762

763

764

765

766

767

768

769

770

771

772

773

774

775

776

777

778

779

780

781

782

783

784

785

786

787

788

789

790

791

792

793

794

795

796

797

798

799

800

801

802

803

804

805

806

807

808

809

810

811

812

813

814

815

816

817

818

819

820

821

822

823

824

825

826

827

828

829

830

831

832

833

834

835

836

837

838

839

840

841

842

843

844

845

846

847

848

849

850

851

852

853

854

855

856

857

858

859

860

861

862

863

864

865

866

867

868

869

870

871

872

873

874

875

876

877

878

879

880

881

882

883

884

885

886

887

888

889

890

891

892

893

894

895

896

897

898

899

900

901

902

903

904

905

906

907

908

909

910

911

912

913

914

915

916

917

918

919

920

921

922

923

924

925

926

927

928

929

930

931

932

933

934

935

936

937

938

939

940

941

942

943

944

945

946

947

948

949

950

951

952

953

954

955

956

957

958

959

960

961

962

963

964

965

966

967

968

969

970

971

972

973

974

975

976

977

978

979

980

981

982

983

984

985

986

987

988

989

990

991

992

993

994

995

996

997

998

999

1000

1001

1002

1003

1004

1005

1006

1007

1008

1009

1010

1011

1012

1013

1014

1015

1016

1017

1018

1019

1020

1021

1022

1023

1024

1025

1026

1027

1028

1029

1030

1031

1032

1033

1034

1035

1036

1037

1038

1039

1040

1041

1042

1043

1044

1045

1046

1047

1048

1049

1050

1051

1052

1053

1054

1055

1056

1057

1058

1059

1060

1061

1062

1063

1064

1065

package secret

import (

"fmt"

"github.com/aquasecurity/trivy/pkg/fanal/types"

iacRules "github.com/aquasecurity/trivy/pkg/iac/rules"

xslices "github.com/aquasecurity/trivy/pkg/x/slices"

)

var (

CategoryAWS=types.SecretRuleCategory("AWS")

CategoryGitHub=types.SecretRuleCategory("GitHub")

CategoryGitLab=types.SecretRuleCategory("GitLab")

CategoryAsymmetricPrivateKey=types.SecretRuleCategory("AsymmetricPrivateKey")

CategoryShopify=types.SecretRuleCategory("Shopify")

CategorySlack=types.SecretRuleCategory("Slack")

CategoryGoogle=types.SecretRuleCategory("Google")

CategoryStripe=types.SecretRuleCategory("Stripe")

CategoryPyPI=types.SecretRuleCategory("PyPI")

CategoryHeroku=types.SecretRuleCategory("Heroku")

CategoryTwilio=types.SecretRuleCategory("Twilio")

CategoryAge=types.SecretRuleCategory("Age")

CategoryFacebook=types.SecretRuleCategory("Facebook")

CategoryTwitter=types.SecretRuleCategory("Twitter")

CategoryAdobe=types.SecretRuleCategory("Adobe")

CategoryAlibaba=types.SecretRuleCategory("Alibaba")

CategoryAsana=types.SecretRuleCategory("Asana")

CategoryAtlassian=types.SecretRuleCategory("Atlassian")

CategoryBitbucket=types.SecretRuleCategory("Bitbucket")

CategoryBeamer=types.SecretRuleCategory("Beamer")

CategoryClojars=types.SecretRuleCategory("Clojars")

CategoryContentfulDelivery=types.SecretRuleCategory("ContentfulDelivery")

CategoryDatabricks=types.SecretRuleCategory("Databricks")

CategoryDiscord=types.SecretRuleCategory("Discord")

CategoryDoppler=types.SecretRuleCategory("Doppler")

CategoryDropbox=types.SecretRuleCategory("Dropbox")

CategoryDuffel=types.SecretRuleCategory("Duffel")

CategoryDynatrace=types.SecretRuleCategory("Dynatrace")

CategoryEasypost=types.SecretRuleCategory("Easypost")

CategoryFastly=types.SecretRuleCategory("Fastly")

CategoryFinicity=types.SecretRuleCategory("Finicity")

CategoryFlutterwave=types.SecretRuleCategory("Flutterwave")

CategoryFrameio=types.SecretRuleCategory("Frameio")

CategoryGoCardless=types.SecretRuleCategory("GoCardless")

CategoryGrafana=types.SecretRuleCategory("Grafana")

CategoryHashiCorp=types.SecretRuleCategory("HashiCorp")

CategoryHubSpot=types.SecretRuleCategory("HubSpot")

CategoryIntercom=types.SecretRuleCategory("Intercom")

CategoryIonic=types.SecretRuleCategory("Ionic")

CategoryJWT=types.SecretRuleCategory("JWT")

CategoryLinear=types.SecretRuleCategory("Linear")

CategoryLob=types.SecretRuleCategory("Lob")

CategoryMailchimp=types.SecretRuleCategory("Mailchimp")

CategoryMailgun=types.SecretRuleCategory("Mailgun")

CategoryMapbox=types.SecretRuleCategory("Mapbox")

CategoryMessageBird=types.SecretRuleCategory("MessageBird")

CategoryNewRelic=types.SecretRuleCategory("NewRelic")

CategoryNpm=types.SecretRuleCategory("Npm")

CategoryPlanetscale=types.SecretRuleCategory("Planetscale")

CategoryPrivatePackagist=types.SecretRuleCategory("Private Packagist")

CategoryPostman=types.SecretRuleCategory("Postman")

CategoryPulumi=types.SecretRuleCategory("Pulumi")

CategoryRubyGems=types.SecretRuleCategory("RubyGems")

CategorySendGrid=types.SecretRuleCategory("SendGrid")

CategorySendinblue=types.SecretRuleCategory("Sendinblue")

CategoryShippo=types.SecretRuleCategory("Shippo")

CategoryLinkedIn=types.SecretRuleCategory("LinkedIn")

CategoryTwitch=types.SecretRuleCategory("Twitch")

CategoryTypeform=types.SecretRuleCategory("Typeform")

CategoryDocker=types.SecretRuleCategory("Docker")

CategoryHuggingFace=types.SecretRuleCategory("HuggingFace")

CategorySymfony=types.SecretRuleCategory("Symfony")

CategoryAzure=types.SecretRuleCategory("Azure")

CategoryMaven=types.SecretRuleCategory("Maven")

CategoryOpenAI=types.SecretRuleCategory("OpenAI")

)

// Reusable regex patterns

const (

quote=\`\["'\]?\`

connect=\`\\s\*(:\|=>\|=)?\\s\*\`

endSecret=\`\[.,\]?(\\s+\|$)\`

startWord="(\[^0-9a-zA-Z\_\]\|^)"

endWord="(\[^0-9a-zA-Z\_\]\|$)"

aws=\`aws\_?\`

)

// This function is exported for trivy-plugin-aqua purposes only

funcGetBuiltinRules() \[\]Rule {

returnbuiltinRules

}

// This function is exported for trivy-plugin-aqua purposes only

funcGetSecretRulesMetadata() \[\]iacRules.Check {

returnxslices.Map(builtinRules, func(ruleRule) iacRules.Check {

return iacRules.Check{

Name: rule.ID,

Description: rule.Title,

}

})

}

varbuiltinRules= \[\]Rule{

{

ID: "aws-access-key-id",

Category: CategoryAWS,

Severity: "CRITICAL",

Title: "AWS Access Key ID",

Regex: MustCompileWithoutWordPrefix(fmt.Sprintf(\`(?P<secret>(A3T\[A-Z0-9\]\|AKIA\|AGPA\|AIDA\|AROA\|AIPA\|ANPA\|ANVA\|ASIA)\[A-Z0-9\]{16})%s%s\`, quote, endSecret)),

SecretGroupName: "secret",

Keywords: \[\]string{"AKIA", "AGPA", "AIDA", "AROA", "AIPA", "ANPA", "ANVA", "ASIA"},

},

{

ID: "aws-secret-access-key",

Category: CategoryAWS,

Severity: "CRITICAL",

Title: "AWS Secret Access Key",

Regex: MustCompile(fmt.Sprintf(\`(?i)%s%s(sec(ret)?)?\_?(access)?\_?key%s%s%s(?P<secret>\[A-Za-z0-9\\/\\+=\]{40})%s%s\`, quote, aws, quote, connect, quote, quote, endSecret)),

SecretGroupName: "secret",

Keywords: \[\]string{"key"},

},

{

ID: "github-pat",

Category: CategoryGitHub,

Title: "GitHub Personal Access Token",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>ghp\_\[0-9a-zA-Z\]{36}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"ghp\_"},

},

{

ID: "github-oauth",

Category: CategoryGitHub,

Title: "GitHub OAuth Access Token",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>gho\_\[0-9a-zA-Z\]{36}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"gho\_"},

},

{

// \`ghu\_\` user-to-server tokens keep the legacy fixed format: exactly

// 36 alphanumeric chars. Since 2026-04-27 \`ghs\_\` installation

// tokens use a new stateless format \`ghs\_<APPID>\_<JWT>\` (~520 chars,

// base64url + dot-separated), so they contain \`.\`, \`-\` and \`\_\`.

// GitHub recommends \`ghs\_\[A-Za-z0-9.\\-\_\]{36,}\`. See

// https://github.com/aquasecurity/trivy/issues/10591.

ID: "github-app-token",

Category: CategoryGitHub,

Title: "GitHub App Token",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>(?:ghu\_\[0-9a-zA-Z\]{36}\|ghs\_\[0-9a-zA-Z.\_-\]{36,})\`),

SecretGroupName: "secret",

Keywords: \[\]string{"ghu\_", "ghs\_"},

},

{

ID: "github-refresh-token",

Category: CategoryGitHub,

Title: "GitHub Refresh Token",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>ghr\_\[0-9a-zA-Z\]{76}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"ghr\_"},

},

{

ID: "github-fine-grained-pat",

Category: CategoryGitHub,

Title: "GitHub Fine-grained personal access tokens",

Severity: "CRITICAL",

Regex: MustCompile(\`github\_pat\_\[a-zA-Z0-9\]{22}\_\[a-zA-Z0-9\]{59}\`),

Keywords: \[\]string{"github\_pat\_"},

},

{

ID: "gitlab-pat",

Category: CategoryGitLab,

Title: "GitLab Personal Access Token",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>glpat-\[0-9a-zA-Z\\-\\\_\]{20}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"glpat-"},

},

{

// cf. https://huggingface.co/docs/hub/en/security-tokens

ID: "hugging-face-access-token",

Category: CategoryHuggingFace,

Severity: "CRITICAL",

Title: "Hugging Face Access Token",

Regex: MustCompileWithBoundaries(\`?P<secret>hf\_\[A-Za-z0-9\]{34,40}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"hf\_"},

},

{

ID: "private-key",

Category: CategoryAsymmetricPrivateKey,

Title: "Asymmetric Private Key",

Severity: "HIGH",

Regex: MustCompile(\`(?i)-----\\s\*?BEGIN\[ A-Z0-9\_-\]\*?PRIVATE KEY( BLOCK)?\\s\*?-----\[\\s\]\*?(?P<secret>\[A-Za-z0-9=+/\\\\]\[A-Za-z0-9=+/\\\\\s\]{30,}\[A-Za-z0-9=+/\\\\])\[\\s\]\*?-----\\s\*?END\[ A-Z0-9\_-\]\*? PRIVATE KEY( BLOCK)?\\s\*?-----\`),

SecretGroupName: "secret",

Keywords: \[\]string{"-----"},

},

{

ID: "shopify-token",

Category: CategoryShopify,

Title: "Shopify token",

Severity: "HIGH",

Regex: MustCompile(\`shp(ss\|at\|ca\|pa)\_\[a-fA-F0-9\]{32}\`),

Keywords: \[\]string{"shpss\_", "shpat\_", "shpca\_", "shppa\_"},

},

{

ID: "slack-access-token",

Category: CategorySlack,

Title: "Slack token",

Severity: "HIGH",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>xox\[baprs\]-(\[0-9a-zA-Z\]{10,48})\`),

SecretGroupName: "secret",

Keywords: \[\]string{"xoxb-", "xoxa-", "xoxp-", "xoxr-", "xoxs-"},

},

{

ID: "stripe-publishable-token",

Category: CategoryStripe,

Title: "Stripe Publishable Key",

Severity: "LOW",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>(?i)pk\_(test\|live)\_\[0-9a-z\]{10,32}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"pk\_test\_", "pk\_live\_"},

},

{

ID: "stripe-secret-token",

Category: CategoryStripe,

Title: "Stripe Secret Key",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>(?i)sk\_(test\|live)\_\[0-9a-z\]{10,32}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"sk\_test\_", "sk\_live\_"},

},

{

ID: "pypi-upload-token",

Category: CategoryPyPI,

Title: "PyPI upload token",

Severity: "HIGH",

Regex: MustCompile(\`pypi-AgEIcHlwaS5vcmc\[A-Za-z0-9\\-\_\]{50,1000}\`),

Keywords: \[\]string{"pypi-AgEIcHlwaS5vcmc"},

},

{

ID: "gcp-service-account",

Category: CategoryGoogle,

Title: "Google (GCP) Service-account",

Severity: "CRITICAL",

Regex: MustCompile(\`\\"type\\": \\"service\_account\\"\`),

Keywords: \[\]string{"\\"type\\": \\"service\_account\\""},

},

{

ID: "heroku-api-key",

Category: CategoryHeroku,

Title: "Heroku API Key",

Severity: "HIGH",

Regex: MustCompile(\` (?i)(?P<key>heroku\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[0-9A-F\]{8}-\[0-9A-F\]{4}-\[0-9A-F\]{4}-\[0-9A-F\]{4}-\[0-9A-F\]{12})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"heroku"},

},

{

ID: "slack-web-hook",

Category: CategorySlack,

Title: "Slack Webhook",

Severity: "MEDIUM",

Regex: MustCompile(\`https:\\/\\/hooks.slack.com\\/services\\/\[A-Za-z0-9+\\/\]{44,48}\`),

Keywords: \[\]string{"hooks.slack.com"},

},

{

ID: "twilio-api-key",

Category: CategoryTwilio,

Title: "Twilio API Key",

Severity: "MEDIUM",

Regex: MustCompile(\`SK\[0-9a-fA-F\]{32}\`),

Keywords: \[\]string{"SK"},

},

{

ID: "age-secret-key",

Category: CategoryAge,

Title: "Age secret key",

Severity: "MEDIUM",

Regex: MustCompile(\`AGE-SECRET-KEY-1\[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L\]{58}\`),

Keywords: \[\]string{"AGE-SECRET-KEY-1"},

},

{

ID: "facebook-token",

Category: CategoryFacebook,

Title: "Facebook token",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>facebook\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-f0-9\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"facebook"},

},

{

ID: "twitter-token",

Category: CategoryTwitter,

Title: "Twitter token",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>twitter\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-f0-9\]{35,44})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"twitter"},

},

{

ID: "adobe-client-id",

Category: CategoryAdobe,

Title: "Adobe Client ID (Oauth Web)",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>adobe\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-f0-9\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"adobe"},

},

{

ID: "adobe-client-secret",

Category: CategoryAdobe,

Title: "Adobe Client Secret",

Severity: "LOW",

Regex: MustCompile(\`(p8e-)(?i)\[a-z0-9\]{32}\`),

Keywords: \[\]string{"p8e-"},

},

{

ID: "alibaba-access-key-id",

Category: CategoryAlibaba,

Title: "Alibaba AccessKey ID",

Severity: "HIGH",

Regex: MustCompile(\`(\[^0-9A-Za-z\]\|^)(?P<secret>(LTAI)(?i)\[a-z0-9\]{20})(\[^0-9A-Za-z\]\|$)\`),

SecretGroupName: "secret",

Keywords: \[\]string{"LTAI"},

},

{

ID: "alibaba-secret-key",

Category: CategoryAlibaba,

Title: "Alibaba Secret Key",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(?P<key>alibaba\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\]{30})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"alibaba"},

},

{

ID: "asana-client-id",

Category: CategoryAsana,

Title: "Asana Client ID",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>asana\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[0-9\]{16})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"asana"},

},

{

ID: "asana-client-secret",

Category: CategoryAsana,

Title: "Asana Client Secret",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>asana\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"asana"},

},

{

ID: "atlassian-api-token",

Category: CategoryAtlassian,

Title: "Atlassian API token",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(?P<key>atlassian\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\]{24})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"atlassian"},

},

{

ID: "bitbucket-client-id",

Category: CategoryBitbucket,

Title: "Bitbucket client ID",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(?P<key>bitbucket\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"bitbucket"},

},

{

ID: "bitbucket-client-secret",

Category: CategoryBitbucket,

Title: "Bitbucket client secret",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(?P<key>bitbucket\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\_\\-\]{64})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"bitbucket"},

},

{

ID: "beamer-api-token",

Category: CategoryBeamer,

Title: "Beamer API token",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>beamer\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>b\_\[a-z0-9=\_\\-\]{44})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"beamer"},

},

{

ID: "clojars-api-token",

Category: CategoryClojars,

Title: "Clojars API token",

Severity: "MEDIUM",

Regex: MustCompile(\`(CLOJARS\_)(?i)\[a-z0-9\]{60}\`),

Keywords: \[\]string{"CLOJARS\_"},

},

{

ID: "contentful-delivery-api-token",

Category: CategoryContentfulDelivery,

Title: "Contentful delivery API token",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>contentful\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\\-=\_\]{43})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"contentful"},

},

{

ID: "databricks-api-token",

Category: CategoryDatabricks,

Title: "Databricks API token",

Severity: "MEDIUM",

Regex: MustCompile(\`dapi\[a-h0-9\]{32}\`),

Keywords: \[\]string{"dapi"},

},

{

ID: "discord-api-token",

Category: CategoryDiscord,

Title: "Discord API key",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>discord\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-h0-9\]{64})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"discord"},

},

{

ID: "discord-client-id",

Category: CategoryDiscord,

Title: "Discord client ID",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>discord\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[0-9\]{18})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"discord"},

},

{

ID: "discord-client-secret",

Category: CategoryDiscord,

Title: "Discord client secret",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>discord\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9=\_\\-\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"discord"},

},

{

ID: "doppler-api-token",

Category: CategoryDoppler,

Title: "Doppler API token",

Severity: "MEDIUM",

Regex: MustCompile(\`\['\\"\](dp\\.pt\\.)(?i)\[a-z0-9\]{43}\['\\"\]\`),

Keywords: \[\]string{"dp.pt."},

},

{

ID: "dropbox-api-secret",

Category: CategoryDropbox,

Title: "Dropbox API secret/key",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(dropbox\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](\[a-z0-9\]{15})\['\\"\]\`),

Keywords: \[\]string{"dropbox"},

},

{

ID: "dropbox-short-lived-api-token",

Category: CategoryDropbox,

Title: "Dropbox short lived API token",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(dropbox\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](sl\\.\[a-z0-9\\-=\_\]{135})\['\\"\]\`),

Keywords: \[\]string{"dropbox"},

},

{

ID: "dropbox-long-lived-api-token",

Category: CategoryDropbox,

Title: "Dropbox long lived API token",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(dropbox\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\]\[a-z0-9\]{11}(AAAAAAAAAA)\[a-z0-9\\-\_=\]{43}\['\\"\]\`),

Keywords: \[\]string{"dropbox"},

},

{

ID: "duffel-api-token",

Category: CategoryDuffel,

Title: "Duffel API token",

Severity: "LOW",

Regex: MustCompile(\`\['\\"\]duffel\_(test\|live)\_(?i)\[a-z0-9\_-\]{43}\['\\"\]\`),

Keywords: \[\]string{"duffel\_test\_", "duffel\_live\_"},

},

{

ID: "dynatrace-api-token",

Category: CategoryDynatrace,

Title: "Dynatrace API token",

Severity: "MEDIUM",

Regex: MustCompile(\`\['\\"\]dt0c01\\.(?i)\[a-z0-9\]{24}\\.\[a-z0-9\]{64}\['\\"\]\`),

Keywords: \[\]string{"dt0c01."},

},

{

ID: "easypost-api-token",

Category: CategoryEasypost,

Title: "EasyPost API token",

Severity: "LOW",

Regex: MustCompile(\`\['\\"\]EZ\[AT\]K(?i)\[a-z0-9\]{54}\['\\"\]\`),

Keywords: \[\]string{"EZAK", "EZAT"},

},

{

ID: "fastly-api-token",

Category: CategoryFastly,

Title: "Fastly API token",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>fastly\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\\-=\_\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"fastly"},

},

{

ID: "finicity-client-secret",

Category: CategoryFinicity,

Title: "Finicity client secret",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>finicity\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\]{20})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"finicity"},

},

{

ID: "finicity-api-token",

Category: CategoryFinicity,

Title: "Finicity API token",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>finicity\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-f0-9\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"finicity"},

},

{

ID: "flutterwave-public-key",

Category: CategoryFlutterwave,

Title: "Flutterwave public/secret key",

Severity: "MEDIUM",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>FLW(PUB\|SEC)K\_TEST-(?i)\[a-h0-9\]{32}-X\`),

SecretGroupName: "secret",

Keywords: \[\]string{"FLWSECK\_TEST-", "FLWPUBK\_TEST-"},

},

{

ID: "flutterwave-enc-key",

Category: CategoryFlutterwave,

Title: "Flutterwave encrypted key",

Severity: "MEDIUM",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>FLWSECK\_TEST\[a-h0-9\]{12}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"FLWSECK\_TEST"},

},

{

ID: "frameio-api-token",

Category: CategoryFrameio,

Title: "Frame.io API token",

Severity: "LOW",

Regex: MustCompile(\`fio-u-(?i)\[a-z0-9\\-\_=\]{64}\`),

Keywords: \[\]string{"fio-u-"},

},

{

ID: "gocardless-api-token",

Category: CategoryGoCardless,

Title: "GoCardless API token",

Severity: "MEDIUM",

Regex: MustCompile(\`\['\\"\]live\_(?i)\[a-z0-9\\-\_=\]{40}\['\\"\]\`),

Keywords: \[\]string{"live\_"},

},

{

ID: "grafana-api-token",

Category: CategoryGrafana,

Title: "Grafana API token",

Severity: "MEDIUM",

Regex: MustCompile(\`\['\\"\]?eyJrIjoi(?i)\[a-z0-9\\-\_=\]{72,92}\['\\"\]?\`),

Keywords: \[\]string{"eyJrIjoi"},

},

{

ID: "hashicorp-tf-api-token",

Category: CategoryHashiCorp,

Title: "HashiCorp Terraform user/org API token",

Severity: "MEDIUM",

Regex: MustCompile(\`\['\\"\](?i)\[a-z0-9\]{14}\\.atlasv1\\.\[a-z0-9\\-\_=\]{60,70}\['\\"\]\`),

Keywords: \[\]string{"atlasv1."},

},

{

ID: "hubspot-api-token",

Title: "HubSpot API token",

Category: CategoryHubSpot,

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>hubspot\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-h0-9\]{8}-\[a-h0-9\]{4}-\[a-h0-9\]{4}-\[a-h0-9\]{4}-\[a-h0-9\]{12})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"hubspot"},

},

{

ID: "intercom-api-token",

Category: CategoryIntercom,

Title: "Intercom API token",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>intercom\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9=\_\]{60})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"intercom"},

},

{

ID: "intercom-client-secret",

Category: CategoryIntercom,

Title: "Intercom client secret/ID",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>intercom\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-h0-9\]{8}-\[a-h0-9\]{4}-\[a-h0-9\]{4}-\[a-h0-9\]{4}-\[a-h0-9\]{12})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"intercom"},

},

{

ID: "ionic-api-token",

Category: CategoryIonic,

Title: "Ionic API token",

Regex: MustCompile(\`(?i)(ionic\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](ion\_\[a-z0-9\]{42})\['\\"\]\`),

Keywords: \[\]string{"ionic"},

},

{

ID: "jwt-token",

Category: CategoryJWT,

Title: "JWT token",

Severity: "MEDIUM",

// The optional \`ghs\_<APPID>\_\` prefix is part of the full match (which the

// allow-rule below inspects) but not of the \`secret\` group (which is

// reported). This drops the JWT embedded in a stateless GitHub App token

// so it is reported only once, by the \`github-app-token\` rule, while

// standalone JWTs keep matching and are reported exactly as before.

Regex: MustCompile(\`(?:ghs\_\[0-9\]+\_)?(?P<secret>ey\[a-zA-Z0-9\]{17,}\\.ey\[a-zA-Z0-9\\/\\\\_-\]{17,}\\.(?:\[a-zA-Z0-9\\/\\\\_-\]{10,}={0,2})?)\`),

SecretGroupName: "secret",

AllowRules: AllowRules{

{

ID: "stateless-ghs-jwt",

Description: "Avoid double-reporting the JWT embedded in a stateless ghs\_ GitHub App token",

Regex: MustCompile(\`^ghs\_\`),

},

},

Keywords: \[\]string{".eyJ"},

},

{

ID: "linear-api-token",

Category: CategoryLinear,

Title: "Linear API token",

Severity: "MEDIUM",

Regex: MustCompile(\`lin\_api\_(?i)\[a-z0-9\]{40}\`),

Keywords: \[\]string{"lin\_api\_"},

},

{

ID: "linear-client-secret",

Category: CategoryLinear,

Title: "Linear client secret/ID",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>linear\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-f0-9\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"linear"},

},

{

ID: "lob-api-key",

Category: CategoryLob,

Title: "Lob API Key",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>lob\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>(live\|test)\_\[a-f0-9\]{35})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"lob"},

},

{

ID: "lob-pub-api-key",

Category: CategoryLob,

Title: "Lob Publishable API Key",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>lob\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>(test\|live)\_pub\_\[a-f0-9\]{31})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"lob"},

},

{

ID: "mailchimp-api-key",

Category: CategoryMailchimp,

Title: "Mailchimp API key",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>mailchimp\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-f0-9\]{32}-us20)\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"mailchimp"},

},

{

ID: "mailgun-token",

Category: CategoryMailgun,

Title: "Mailgun private API token",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>mailgun\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>(pub)?key-\[a-f0-9\]{32})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"mailgun"},

},

{

ID: "mailgun-signing-key",

Category: CategoryMailgun,

Title: "Mailgun webhook signing key",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>mailgun\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-h0-9\]{32}-\[a-h0-9\]{8}-\[a-h0-9\]{8})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"mailgun"},

},

{

ID: "mapbox-api-token",

Category: CategoryMapbox,

Title: "Mapbox API token",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(pk\\.\[a-z0-9\]{60}\\.\[a-z0-9\]{22})\`),

Keywords: \[\]string{"pk."},

},

{

ID: "messagebird-api-token",

Category: CategoryMessageBird,

Title: "MessageBird API token",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>messagebird\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\]{25})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"messagebird"},

},

{

ID: "messagebird-client-id",

Category: CategoryMessageBird,

Title: "MessageBird API client ID",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>messagebird\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-h0-9\]{8}-\[a-h0-9\]{4}-\[a-h0-9\]{4}-\[a-h0-9\]{4}-\[a-h0-9\]{12})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"messagebird"},

},

{

ID: "new-relic-user-api-key",

Category: CategoryNewRelic,

Title: "New Relic user API Key",

Severity: "MEDIUM",

Regex: MustCompile(\`\['\\"\](NRAK-\[A-Z0-9\]{27})\['\\"\]\`),

Keywords: \[\]string{"NRAK-"},

},

{

ID: "new-relic-user-api-id",

Category: CategoryNewRelic,

Title: "New Relic user API ID",

Severity: "MEDIUM",

Regex: MustCompile(\`(?i)(?P<key>newrelic\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[A-Z0-9\]{64})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"newrelic"},

},

{

ID: "new-relic-browser-api-token",

Category: CategoryNewRelic,

Title: "New Relic ingest browser API token",

Severity: "MEDIUM",

Regex: MustCompile(\`\['\\"\](NRJS-\[a-f0-9\]{19})\['\\"\]\`),

Keywords: \[\]string{"NRJS-"},

},

{

ID: "npm-access-token",

Category: CategoryNpm,

Title: "npm access token",

Severity: "CRITICAL",

Regex: MustCompile(\`\['\\"\](npm\_(?i)\[a-z0-9\]{36})\['\\"\]\`),

Keywords: \[\]string{"npm\_"},

},

{

ID: "planetscale-password",

Category: CategoryPlanetscale,

Title: "PlanetScale password",

Severity: "MEDIUM",

Regex: MustCompile(\`pscale\_pw\_(?i)\[a-z0-9\\-\_\\.\]{43}\`),

Keywords: \[\]string{"pscale\_pw\_"},

},

{

ID: "planetscale-api-token",

Category: CategoryPlanetscale,

Title: "PlanetScale API token",

Severity: "MEDIUM",

Regex: MustCompile(\`pscale\_tkn\_(?i)\[a-z0-9\\-\_\\.\]{43}\`),

Keywords: \[\]string{"pscale\_tkn\_"},

},

{

ID: "private-packagist-token",

Category: CategoryPrivatePackagist,

Title: "Private Packagist token",

Severity: "HIGH",

// https://packagist.com/docs/composer-authentication#token-format

Regex: MustCompile(\`packagist\_\[ou\]\[ru\]t\_(?i)\[a-f0-9\]{68}\`),

Keywords: \[\]string{"packagist\_uut\_", "packagist\_ort\_", "packagist\_out\_"},

},

{

ID: "postman-api-token",

Category: CategoryPostman,

Title: "Postman API token",

Severity: "MEDIUM",

Regex: MustCompile(\`PMAK-(?i)\[a-f0-9\]{24}\\-\[a-f0-9\]{34}\`),

Keywords: \[\]string{"PMAK-"},

},

{

ID: "pulumi-api-token",

Category: CategoryPulumi,

Title: "Pulumi API token",

Severity: "HIGH",

Regex: MustCompile(\`pul-\[a-f0-9\]{40}\`),

Keywords: \[\]string{"pul-"},

},

{

ID: "rubygems-api-token",

Category: CategoryRubyGems,

Title: "Rubygem API token",

Severity: "MEDIUM",

Regex: MustCompile(\`rubygems\_\[a-f0-9\]{48}\`),

Keywords: \[\]string{"rubygems\_"},

},

{

ID: "sendgrid-api-token",

Category: CategorySendGrid,

Title: "SendGrid API token",

Severity: "MEDIUM",

Regex: MustCompile(\`SG\\.(?i)\[a-z0-9\_\\-\\.\]{66}\`),

Keywords: \[\]string{"SG."},

},

{

ID: "sendinblue-api-token",

Category: CategorySendinblue,

Title: "Sendinblue API token",

Severity: "LOW",

Regex: MustCompile(\`xkeysib-\[a-f0-9\]{64}\\-(?i)\[a-z0-9\]{16}\`),

Keywords: \[\]string{"xkeysib-"},

},

{

ID: "shippo-api-token",

Category: CategoryShippo,

Title: "Shippo API token",

Severity: "LOW",

Regex: MustCompile(\`shippo\_(live\|test)\_\[a-f0-9\]{40}\`),

Keywords: \[\]string{"shippo\_live\_", "shippo\_test\_"},

},

{

ID: "linkedin-client-secret",

Category: CategoryLinkedIn,

Title: "LinkedIn Client secret",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>linkedin\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z\]{16})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"linkedin"},

},

{

ID: "linkedin-client-id",

Category: CategoryLinkedIn,

Title: "LinkedIn Client ID",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>linkedin\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\]{14})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"linkedin"},

},

{

ID: "twitch-api-token",

Category: CategoryTwitch,

Title: "Twitch API token",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>twitch\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}\['\\"\](?P<secret>\[a-z0-9\]{30})\['\\"\]\`),

SecretGroupName: "secret",

Keywords: \[\]string{"twitch"},

},

{

ID: "typeform-api-token",

Category: CategoryTypeform,

Title: "Typeform API token",

Severity: "LOW",

Regex: MustCompile(\`(?i)(?P<key>typeform\[a-z0-9\_ .\\-,\]{0,25})(=\|>\|:=\|\\\|\\\|:\|<=\|=>\|:).{0,5}(?P<secret>tfp\_\[a-z0-9\\-\_\\.=\]{59})\`),

SecretGroupName: "secret",

Keywords: \[\]string{"typeform"},

},

{

ID: "dockerconfig-secret",

Category: CategoryDocker,

Title: "Dockerconfig secret exposed",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(\\.(dockerconfigjson\|dockercfg):\\s\*\\\|\*\\s\*(?P<secret>(ey\|ew)+\[A-Za-z0-9\\/\\+=\]+))\`),

SecretGroupName: "secret",

Keywords: \[\]string{"dockerc"},

},

{

ID: "symfony-default-secret",

Category: CategorySymfony,

Title: "Symfony Default Secret",

Severity: "HIGH",

Regex: MustCompile(\`ThisTokenIsNotSoSecretChangeIt\|ThisEzPlatformTokenIsNotSoSecret\_PleaseChangeIt\`),

Keywords: \[\]string{"TokenIsNotSoSecret"},

},

{

ID: "azure-storage-account-key",

Category: CategoryAzure,

Title: "Azure Storage Account Key",

Severity: "CRITICAL",

Regex: MustCompile(\`(?i)AccountKey\\s\*=\\s\*(?P<secret>\[A-Za-z0-9+/\]{86}==)\`),

SecretGroupName: "secret",

Keywords: \[\]string{"AccountKey"},

},

{

ID: "azure-sas-token",

Category: CategoryAzure,

Title: "Azure Shared Access Signature Token",

Severity: "HIGH",

Regex: MustCompile(\`sv=\\d{4}-\\d{2}-\\d{2}(?:\[&;\]\[a-z\]+=\[^&\\s'"\]\*){1,12}\[&;\]sig=(?P<secret>\[A-Za-z0-9%+/=\]{40,})\`),

SecretGroupName: "secret",

Keywords: \[\]string{"sig=", "sv="},

},

{

ID: "azure-devops-pat",

Category: CategoryAzure,

Title: "Azure DevOps Personal Access Token",

Severity: "HIGH",

Regex: MustCompile(\`(?i)(?:azure\[\_\\-\]?devops\|ado)\[\_\\-\]?(?:pat\|token\|personal.?access.?token)\\s\*\[:=\]\\s\*\["'\]?(?P<secret>\[a-z2-7\]{52})\["'\]?\`),

SecretGroupName: "secret",

Keywords: \[\]string{

"azure\_devops", "azuredevops", "azure-devops", "ado\_pat", "ado\_token", "ado-pat", "ado-token",

},

},

{

ID: "azure-entra-client-secret",

Category: CategoryAzure,

Title: "Azure Entra ID Client Secret",

Severity: "CRITICAL",

Regex: MustCompile(\`(?:\[^a-zA-Z0-9\_~.\\-\]\|\\A)(?P<secret>\[a-zA-Z0-9\_~.\\-\]{3}8Q~\[a-zA-Z0-9\_~.\\-\]{34})(?:\[^a-zA-Z0-9\_~.\\-\]\|\\z)\`),

SecretGroupName: "secret",

Keywords: \[\]string{"8Q~"},

},

{

ID: "azure-container-registry-credential",

Category: CategoryAzure,

Title: "Azure Container Registry Credential",

Severity: "CRITICAL",

Regex: MustCompile(\`(?P<secret>\[A-Za-z0-9+/\]{52}JQQJ99C\[A-Z\]ACYeBjFEqg7NAAA\[A-Z\]AZCR\[A-Za-z0-9+/\]{4})\`),

SecretGroupName: "secret",

Keywords: \[\]string{"ACYeBjFEqg7NAAA"},

},

{

ID: "azure-container-registry-password",

Category: CategoryAzure,

Title: "Azure Container Registry Password",

Severity: "CRITICAL",

Regex: MustCompile(\`(?i)azurecr\\.io\[^\\n\]{0,100}(?:password\|pwd)\\s\*\[:=\]\\s\*\["'\]?(?P<secret>\[a-zA-Z0-9+/\]{32})\["'\]?\`),

SecretGroupName: "secret",

Keywords: \[\]string{"azurecr.io"},

},

{

ID: "azure-app-config-connection-string",

Category: CategoryAzure,

Title: "Azure App Configuration Connection String",

Severity: "CRITICAL",

Regex: MustCompile(\`(?i)Endpoint\\s\*=\\s\*https://\[a-zA-Z0-9\\-\]+\\.azconfig\\.io\\s\*;\\s\*Id\\s\*=\\s\*\[a-zA-Z0-9+/=:\\-\]+\\s\*;\\s\*Secret\\s\*=\\s\*(?P<secret>\[a-zA-Z0-9+/=~\]{32,88})\`),

SecretGroupName: "secret",

Keywords: \[\]string{"azconfig.io"},

},

{

ID: "azure-ai-services-key",

Category: CategoryAzure,

Title: "Azure AI Services Key",

Severity: "HIGH",

Regex: MustCompile(\`(?P<secret>\[A-Za-z0-9+/\]{52}JQQJ99C\[A-Z\]\[A-Za-z0-9+/\]{7}XJ3w3\[A-Za-z0-9+/\]{4}ACOG\[A-Za-z0-9+/\]{4})\`),

SecretGroupName: "secret",

Keywords: \[\]string{"XJ3w3"},

},

// Maven secrets for settings.xml and settings-security.xml — common storage for

// repository/server credentials baked into images.

//

// Path matches any settings.xml on the filesystem (not anchored to ~/.m2 or

// /etc/maven) because Maven settings ship in many locations and a narrower

// filter would miss legitimate cases. The XML tag combined with file name is

// already specific enough to keep false positives low.

//

// \`password\` and \`passphrase\` exclude \`{\` from the secret value, which skips

// both Maven-encrypted values (\`{...}\`, see

// plexus-cipher.DefaultPlexusCipher#ENCRYPTED\_STRING\_PATTERN) and Maven

// property substitution (\`${env.X}\`, \`${prop.Y}\`). Encrypted values are

// useless without the master from settings-security.xml (detected by a

// separate rule), and property placeholders are references rather than

// literal secrets.

{

ID: "maven-settings-password",

Category: CategoryMaven,

Title: "Maven settings.xml password",

Severity: "HIGH",

Regex: MustCompile(\`(?i)<\\s\*password\\s\*>\\s\*(?P<secret>\[^<\\s{\]\[^<{\]+\[^<\\s\])\\s\*<\\s\*/\\s\*password\\s\*>\`),

Path: MustCompile(\`(?i)(^\|\[/\\\\])settings\\.xml$\`),

SecretGroupName: "secret",

Keywords: \[\]string{"password"},

},

{

ID: "maven-settings-passphrase",

Category: CategoryMaven,

Title: "Maven settings.xml passphrase",

Severity: "HIGH",

Regex: MustCompile(\`(?i)<\\s\*passphrase\\s\*>\\s\*(?P<secret>\[^<\\s{\]\[^<{\]+\[^<\\s\])\\s\*<\\s\*/\\s\*passphrase\\s\*>\`),

Path: MustCompile(\`(?i)(^\|\[/\\\\])settings\\.xml$\`),

SecretGroupName: "secret",

Keywords: \[\]string{"passphrase"},

},

{

ID: "maven-settings-security-master",

Category: CategoryMaven,

Title: "Maven settings-security.xml master password",

Severity: "HIGH",

Regex: MustCompile(\`(?i)<\\s\*master\\s\*>\\s\*(?P<secret>\[^<\\s\]\[^<\]+\[^<\\s\])\\s\*<\\s\*/\\s\*master\\s\*>\`),

Path: MustCompile(\`(?i)(^\|\[/\\\\])settings-security\\.xml$\`),

SecretGroupName: "secret",

Keywords: \[\]string{"master"},

},

// OpenAI API credentials. Every sk-\* key embeds the watermark "T3BlbkFJ"

// (base64 of "OpenAI") between two random segments of equal length, used as the

// pre-filter keyword. The watermark is the real discriminator, so the wide

// {20,100} length range does not raise false-positive risk and the rules do not

// clash with other vendors that reuse the \`sk-\` prefix (Anthropic \`sk-ant-\`,

// OpenRouter \`sk-or-v1-\`), which carry no watermark.

//

// The active-key rules (proj/svcacct/admin) and the service-key rule carry

// distinct literal prefixes, so they never overlap with each other. The legacy

// rule is restricted to \`\[A-Za-z0-9\]\` (no \`-\`/\`\_\`) so its {20,42} run cannot

// bridge the hyphen in \`sk-proj-\`, \`sk-svcacct-\`, \`sk-admin-\` or \`sk-service-\`;

// this keeps a typed key from also matching the bare legacy pattern.

{

ID: "openai-project-api-key",

Category: CategoryOpenAI,

Title: "OpenAI Project API Key",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>sk-proj-\[A-Za-z0-9\_-\]{20,100}T3BlbkFJ\[A-Za-z0-9\_-\]{20,100}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"T3BlbkFJ"},

},

{

ID: "openai-service-account-key",

Category: CategoryOpenAI,

Title: "OpenAI Service Account Key",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>sk-svcacct-\[A-Za-z0-9\_-\]{20,100}T3BlbkFJ\[A-Za-z0-9\_-\]{20,100}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"T3BlbkFJ"},

},

{

ID: "openai-admin-api-key",

Category: CategoryOpenAI,

Title: "OpenAI Admin API Key",

Severity: "CRITICAL",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>sk-admin-\[A-Za-z0-9\_-\]{20,100}T3BlbkFJ\[A-Za-z0-9\_-\]{20,100}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"T3BlbkFJ"},

},

{

ID: "openai-legacy-api-key",

Category: CategoryOpenAI,

Title: "OpenAI Legacy User API Key",

Severity: "HIGH",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>sk-(?:None-)?\[A-Za-z0-9\]{20,42}T3BlbkFJ\[A-Za-z0-9\]{20,42}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"T3BlbkFJ"},

},

{

ID: "openai-service-api-key",

Category: CategoryOpenAI,

Title: "OpenAI Service API Key",

Severity: "HIGH",

Regex: MustCompileWithoutWordPrefix(\`?P<secret>sk-service-\[A-Za-z0-9-\]+-\[A-Za-z0-9\]{20}T3BlbkFJ\[A-Za-z0-9\]{20}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"T3BlbkFJ"},

},

{

ID: "openai-realtime-client-secret",

Category: CategoryOpenAI,

Title: "OpenAI Realtime Client Secret",

Severity: "MEDIUM",

Regex: MustCompileWithBoundaries(\`?P<secret>ek\_\[a-f0-9\]{32}\`),

SecretGroupName: "secret",

Keywords: \[\]string{"ek\_"},

},

}

You can’t perform that action at this time.


While the code is focused, press Alt+F1 for a menu of operations.
