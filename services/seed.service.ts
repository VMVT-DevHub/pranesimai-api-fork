'use strict';

import moleculer from 'moleculer';
import crypto from 'crypto';
import { Action, Method, Service } from 'moleculer-decorators';
import { Survey, SurveyAuthType } from './surveys.service';
import { Page } from './pages.service';
import { AuthRelation, Question, QuestionType } from './questions.service';
import { QuestionOption } from './questionOptions.service';
import DbConnection from '../mixins/database.mixin';

const IS_SEED_REFRESH_ENABLED = process.env.IS_SEED_REFRESH_ENABLED === 'true';
const TEMPLATE_VERSION = 'v1';

type SurveyTemplate = {
  title: Survey['title'];
  description?: Survey['description'];
  icon: Survey['icon'];
  authType: SurveyAuthType;
  spList: Survey['spList'];
  pages: Array<{
    id?: Page['id'];
    title: Page['title'];
    description?: Page['description'];
    dynamicFields?: Array<{
      condition: {
        question: number | string; // virtual id
        value?: Page['dynamicFields'][number]['condition']['value'];
        valueIndex?: number; // index of question option
      };
      values: Page['dynamicFields'][number]['values'];
    }>;
    questions?: Array<{
      id: string; // excel id
      nextQuestion?: string; // excel id
      type: Question['type'];
      title: Question['title'];
      hint?: Question['hint'];
      spField?: Question['spField'];
      description?: Question['description'];
      required: Question['required'];
      riskEvaluation: Question['riskEvaluation'];
      authRelation?: Question['authRelation'];
      condition?: {
        question: number | string; // excel id
        value?: Question['condition']['value']; // if not present, will be detected automatically
        valueIndex?: number; // index of question option
      };
      dynamicFields?: Array<{
        condition: {
          question: number | string; // virtual id
          value?: Question['dynamicFields'][number]['condition']['value'];
          valueIndex?: number; // index of question option
        };
        values: Question['dynamicFields'][number]['values'];
      }>;
      options?: Array<{
        nextQuestion?: string; // excel id
        title: QuestionOption['title'];
      }>;
    }>;
  }>;
};

type SurveyTemplatePage = SurveyTemplate['pages'][number];
type SurveyTemplateQuestion = SurveyTemplatePage['questions'][number];
type QuestionExtends = Partial<SurveyTemplateQuestion>;

const q = (
  type: QuestionType,
  id: number | string,
  nextQuestion: number | string,
  title: Question['title'],
  fields: Partial<SurveyTemplateQuestion> = {},
): SurveyTemplateQuestion => ({
  id: `${id}`,
  nextQuestion: nextQuestion && `${nextQuestion}`,
  type,
  title,
  required: true,
  riskEvaluation: true,
  ...fields,
});

type TypeFactory = (
  id: number | string,
  nextQuestion: number | string,
  title: Question['title'],
  fields?: Partial<SurveyTemplateQuestion>,
) => SurveyTemplateQuestion;

q.input = q.bind(null, QuestionType.INPUT) as TypeFactory;
q.date = q.bind(null, QuestionType.DATE) as TypeFactory;
q.datetime = q.bind(null, QuestionType.DATETIME) as TypeFactory;
q.select = q.bind(null, QuestionType.SELECT) as TypeFactory;
q.multiselect = q.bind(null, QuestionType.MULTISELECT) as TypeFactory;
q.radio = q.bind(null, QuestionType.RADIO) as TypeFactory;
q.location = q.bind(null, QuestionType.LOCATION) as TypeFactory;
q.text = q.bind(null, QuestionType.TEXT) as TypeFactory;
q.checkbox = q.bind(null, QuestionType.CHECKBOX) as TypeFactory;
q.files = q.bind(null, QuestionType.FILES) as TypeFactory;

// condition
const c = (id: number | string) => ({
  question: `${id}`,
});

// dynamicFields multi options
const dm = (question: number | string, indexes: number[], values: any = {}) =>
  indexes.map((valueIndex) => ({
    condition: {
      question,
      valueIndex,
    },
    values,
  }));

// options
const o = (options: string[]) =>
  options.map((title) => ({
    title,
  }));

// single option helper
const os = (title: string, nextQuestion?: number | string) => ({
  title,
  nextQuestion: nextQuestion && `${nextQuestion}`,
});

const helperVeiklos = (id: number | string, idOut: number | string, qa: QuestionExtends = {}) => [
  q.radio(id, undefined, 'Nurodykite prekybos būdą', {
    options: [os('Fizinėje prekybos vietoje', `${id}.1`), os('Internetu', `${id}.2`)],
    spField: 'prek_tip',
    ...qa,
  }),
  q.location(`${id}.1`, idOut, 'Žemėlapyje nurodykite pardavimo vietą', {
    condition: c(id),
    required: false,
    spField: 'koord',
    ...qa,
  }),
  q.input(`${id}.2`, idOut, 'Pateikite nuoroda į internetinės prekybos puslapį', {
    condition: c(id),
    spField: 'pap_info',
    ...qa,
  }),
];

const AddressHelper = (id: number | string, idOut: number | string, qa: QuestionExtends = {}) => [
  q.radio(id, undefined, 'Nurodykite prekybos būdą', {
    options: [os('Fizinėje prekybos vietoje', `${id}.1`), os('Internetu', `${id}.2`)],
    spField: 'prek_tip',
    ...qa,
  }),
  q.input(`${id}.1`, idOut, 'Nurodykite prekybos vietos adresą (sav., gyv., gatvė, namas, butas)', {
    condition: c(id),
    spField: 'adresas',
    ...qa,
  }),
  q.input(`${id}.2`, idOut, 'Pateikite nuoroda į internetinės prekybos puslapį', {
    condition: c(id),
    spField: 'pap_info',
    ...qa,
  }),
];

const pages = {
  kontaktiniai: (
    id: number,
    q1: QuestionExtends = {},
    additionalQuestinos: SurveyTemplateQuestion[] = [],
  ) => ({
    title: 'Kontaktiniai duomenys',
    description: 'Patikslinkite savo kontaktinius duomenis',
    questions: [
      q.input(id, id + 1, 'El. pašto adresas', {
        riskEvaluation: false,
        authRelation: AuthRelation.EMAIL,
        spField: 'pran_email',
        ...q1,
      }),
      ...additionalQuestinos,
    ],
  }),

  tema: () => ({
    title: 'Pranešimo tema',
    description: 'Pasirinkite, dėl ko teikiate pranešimą',
  }),

  detales: () => ({
    title: 'Pranešimo detalės',
    description: 'Pateikite išsamią informaciją',
  }),

  papildoma: () => ({
    title: 'Papildoma informacija',
  }),

  informacija: (
    id: number,
    q1: QuestionExtends = {},
    q2: QuestionExtends = {},
    q3: QuestionExtends = {},
    e: any = {},
  ) => ({
    title: 'Veiklos informacija',
    description: 'Pateikite papildomą informaciją',
    questions: [
      q.location(id, id + 1, '', {
        riskEvaluation: false,
        ...q1,
      }),
      q.input(id + 1, id + 2, 'Nurodykite veiklos pavadinimą', {
        riskEvaluation: false,
        ...q2,
      }),
      q.text(id + 2, id + 3, 'Nurodykite veiklą vykdančius fizinius ar juridinius asmenis', {
        riskEvaluation: false,
        ...q3,
      }),
    ],
    ...e,
  }),

  aplinkybes: (
    id: number,
    q1: QuestionExtends = {},
    additionalQuestinos: SurveyTemplateQuestion[] = [],
  ) => ({
    title: 'Įvykio aplinkybės',
    questions: [
      q.text(
        id,
        id + 1,
        'Pateikite visus jums žinomus faktus ir aplinkybes susijusius su pranešamu įvykiu',
        {
          required: true,
          riskEvaluation: false,
          spField: 'aplink',
          ...q1,
        },
      ),
      ...additionalQuestinos,
    ],
  }),

  vaizdine: (id: number, q1: QuestionExtends = {}, q2: QuestionExtends = {}) => ({
    title: 'Vaizdinė medžiaga ir kiti dokumentai',
    description:
      'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus',
    questions: [
      q.radio(id, undefined, 'Ar galite pateikti įrodymų apie pranešamus pažeidimus?', {
        options: [os('Taip', id + 1), os('Ne', id + 2)],
        spField: 'irodym',
        ...q1,
      }),
      q.files(id + 1, id + 2, 'Pridėkite vaizdinę ar kitą medžiagą', {
        riskEvaluation: false,
        condition: c(id),
        spField: 'files',
        ...q2,
      }),
    ],
  }),

  teises: (id: number, q1: QuestionExtends = {}, q2: QuestionExtends = {}) => ({
    title: 'Jūsų teisės, pareigos ir atsakomybės',
    description: 'Sutikimas',
    questions: [
      q.checkbox(id, id + 1, 'Patvirtinu kad susipažinau su pranešimų pateikimo VMVT tvarka', q1),
      q.checkbox(
        id + 1,
        undefined,
        'Patvirtinu, kad esu susipažinęs su teisinėmis pasekmėmis už melagingos informacijos teikimą, o mano teikiama informacija yra teisinga.',
        q2,
      ),
    ],
  }),
};

const SURVEYS_SEED: SurveyTemplate[] = [
  // SURVEY 1
  {
    title: 'Maisto srities pranešimų anketa',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11.0167 29.4973L24.0442 22.2748C28.2967 19.9123 34.8217 26.2798 32.3917 30.6223L25.1467 43.6948C20.4667 52.1098 2.44418 34.2673 11.0167 29.4973Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M24.292 21.375L22.042 16.2225C21.367 14.58 20.467 13.5 18.667 13.5H10.792C6.94449 13.5 5.16699 14.625 5.16699 19.125C5.35564 23.161 6.94719 27.0046 9.66699 29.9925" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M18.667 13.5C18.667 10.0125 19.207 4.5 14.167 4.5C9.66699 4.5 8.54199 9.3825 8.54199 13.5" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M33.2923 30.375L38.4448 32.625C40.0873 33.3 41.1673 34.2 41.1673 36V43.875C41.1673 47.7225 40.0423 49.5 35.5423 49.5C31.5063 49.3113 27.6627 47.7198 24.6748 45" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M41.167 36.0002C44.6545 36.0002 50.167 35.4602 50.167 40.5002C50.167 45.0002 45.2845 46.1252 41.167 46.1252" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
    spList: process.env.SP_LIST,
    description:
      'Pranešimai apie neatitikimus maisto produktų kokybei, saugai, įskaitant maisto produktų, jų tiekėjų ar viešojo maitinimo įstaigų veiklą. Taip pat pranešimai apie nelegalią veiklą, susijusią su maisto produktų gamyba, platinimu ar pardavimu.',
    authType: SurveyAuthType.OPTIONAL,
    pages: [
      // =======================================
      pages.kontaktiniai(3),

      // =======================================
      {
        ...pages.tema(),
        questions: [
          q.select(4, undefined, 'Pasirinkite dėl ko pranešate', {
            riskEvaluation: false,
            options: [
              // os('Dėl įsigytų maisto produktų ar su maistu besiliečiančių medžiagų', 5), // 0
              os(
                'Dėl įsigytų ar pastebėtų prekybos vietoje maisto produktų ar su maistu besiliečiančių medžiagų',
                6,
              ), // 1 --> 0
              os('Dėl įsigytų patiekalų', 7), // 2 --> 1
              os('Dėl suteiktų viešojo maitinimo paslaugų', 8), // 3 -->  2
              os('Dėl vykdomos maisto tvarkymo veiklos pažeidimų', 9), // 4 --> 3
            ],
            spField: 'pran_tip',
          }),
        ],
      },

      // =======================================
      {
        ...pages.detales(),
        dynamicFields: [
          {
            condition: {
              question: 4,
              valueIndex: 0,
            },
            values: {
              title: 'Informacija apie produktą',
            },
          },
          {
            condition: {
              question: 4,
              valueIndex: 0,
            },
            values: {
              title: 'Informacija apie produktą',
            },
          },
          {
            condition: {
              question: 4,
              valueIndex: 1,
            },
            values: {
              title: 'Informacija apie patiekalą',
            },
          },
        ],
        questions: [
          q.date(6, 10, 'Nurodykite produktų įsigijimo arba pastebėjimo prekybos vietoje datą', {
            spField: 'ivykio_data',
          }),
          q.date(7, 11, 'Nurodykite patiekalų įsigijimo datą', {
            spField: 'ivykio_data',
          }),
          q.date(8, 11, 'Nurodykite paslaugų suteikimo datą', {
            spField: 'ivykio_data',
          }),
          q.date(9, 12, 'Nurodykite pranešamų pažeidimų pastebėjimo datą', {
            spField: 'ivykio_data',
          }),
          q.select(10, 13, 'Pasirinkite produkto tipą', {
            options: o([
              'Greitai gendantys produktai',
              'Negreitai gendantys produktai',
              'Su maistu besiliečiančios medžiagos',
              'Maisto papildai',
              'Specialios paskirties maisto produktai',
            ]),
            spField: 'prod_tip',
          }),
          q.select(11, 14, 'Pasirinkite viešojo maitinimo veiklos tipą', {
            riskEvaluation: false,
            options: o([
              'Gėrimų pardavimo vartoti vietose (barų) veikla',
              'Kavinių, užkandinių, restoranų veikla',
              'Maisto pristatymo į namus veikla',
              'Maitinimo paslaugų tiekimo veikla (renginiams, kaimo turizmo sodybos ir kt.)',
              'Ikimokyklinio, mokyklinio ugdymo įstaigų maitinimo veikla',
              'Socialinės globos ir rūpybos įstaigų maitinimo veikla',
              'Sveikatos priežiūros įstaigų maitinimo veikla',
              'Vaikų stovyklų maitinimo veikla',
              'Kita viešojo maitinimo veikla',
            ]),
            spField: 'veik_tip',
          }),
          q.select(12, 15, 'Pasirinkite veiklos tipą', {
            riskEvaluation: false,
            options: o([
              'Kavinių, užkandinių, restoranų veikla',
              'Maisto produktų prekybos veikla',
              'Internetinės maisto produktų prekybos veikla',
              'Maisto produktų gamybos veikla',
              'Maisto gamybos namų ūkio virtuvėse veikla',
              'Ikimokyklinio, mokyklinio ugdymo įstaigų maitinimo veikla',
              'Gėrimų pardavimo vartoti vietose (barų) veikla',
              'Maitinimo paslaugų tiekimo veikla (renginiams, kaimo turizmo sodybos ir kt.)',
              'Socialinės globos ir rūpybos įstaigų maitinimo veikla',
              'Vaikų stovyklų maitinimo veikla',
              'Maisto pristatymo į namus veikla',
              'Sveikatos priežiūros įstaigų maitinimo veikla',
              'Laisvės atėmimo vietų maitinimo veikla',
              'Kepyklų veikla',
              'Maisto produktų fasavimo, pakavimo veikla',
              'Maisto produktų sandėliavimo veikla',
              'Gyvūninio maisto tvarkymo veikla',
              'Alkoholinių gėrimų gamybos veikla',
              'Daržovių, vaisių, uogų kitų maistui vartojamų augalų auginimo veikla',
              'Maisto papildų gamybos veikla',
              'Maisto produktų prekybos iš automatų veikla',
              'Žaliavinio pieno supirkimo punkto, surinkimo centro veikla',
              'Kita veikla',
            ]),
            spField: 'veik_tip',
          }),
          q.multiselect(13, 16, 'Pasirinkite apie kokius produkto pažeidimus pranešate', {
            options: o([
              'Kokybės pažeidimai',
              'Tinkamumo vartoti terminų pažeidimai',
              'Maisto produktų sukelti sveikatos sutrikimai (ligos atvejis)',
              'Ženklinimo pažeidimai',
              'Produktas užterštas cheminiais, fiziniais, mikrobiniais ar kitokiais teršalais',
              'Maisto papildų notifikavimo pažeidimai',
              'Alergenų informacijos pateikimo pažeidimai',
              'Kainų, kiekių, tūrio, svorio neatitikimai',
              'Produktų klastotė',
              'Reklamos pažeidimai',
              'Kiti pažeidimai',
            ]),
            spField: 'paz_tip5',
          }),
          q.multiselect(14, 20, 'Pasirinkite apie kokius pažeidimus pranešate', {
            options: o([
              'Kokybės pažeidimai',
              'Pateiktas sugedęs, netinkamos išvaizdos, skonio, kvapo patiekalas',
              'Patiekalai patiekiami netinkamos temperatūros',
              'Maisto produktų sukelti sveikatos sutrikimai (ligos atvejis)',
              'Patiekalas netinkamai termiškai apdorotas (neiškepęs, perkepęs, sudegintas)',
              'Produktas užterštas cheminiais, fiziniais, mikrobiniais ar kitokiais teršalais',
              'Neleistinos sudedamosios dalys',
              'Alergenų informacijos pateikimo pažeidimai',
              'Netinkamos produktų, patiekalų laikymo sąlygos',
              'Kainų, kiekių, tūrio, svorio neatitikimai',
              'Nesilaikoma sudaryto meniu',
              'Sudarytas meniu neatitinka reikalavimų',
              'Kiti pažeidima',
            ]),
            spField: 'paz_tip5',
          }),
          q.multiselect(15, '21.0', 'Pasirinkite apie kokius veiklos pažeidimus pranešate', {
            options: o([
              'Vykdoma veikla be leidimų/registracijos',
              'Netinkamos produktų, patiekalų laikymo sąlygos',
              'Patalpos nehigieniškos, neatitinka nustatytų reikalavimų',
              'Veikla vykdoma neįsidiegus savikontrolės sistemos',
              'Neužtikrinami biologinės saugos reikalavimai',
              'Netinkamai tvarkomos atliekos',
              'Netinkamai pildomi veiklos dokumentai',
              'Nepateikiama privalomoji informacija apie vykdomą veiklą',
              'Darbuotojų higienos įgūdžių pažeidimai',
              'Ženklinimo pažeidimai',
              'Tinkamumo vartoti terminų pažeidimai',
              'Neleistinos sudedamosios dalys',
              'Produktų klastotės',
              'Maisto papildų notifikavimo pažeidimai',
              'Prekiaujama neleistinais produktais',
              'Reklamos pažeidimai',
              'Kainų, kiekių, tūrio, svorio neatitikimai',
              'Kiti pažeidima',
            ]),
            spField: 'paz_tip5',
          }),
          q.input(16, 17, 'Nurodykite produkto pavadinimą', {
            riskEvaluation: false,
            hint: 'Nurodykite tikslų produkto pavadinimą (pvz. varškės sūrelis "XXXX")',
            spField: 'pavad',
          }),
          q.radio(17, undefined, 'Ar galite nurodyti gamintoją?', {
            riskEvaluation: false,
            options: [os('Taip', '17.1'), os('Ne', 18)],
          }),
          q.input('17.1', 18, 'Produkto gamintojas', {
            riskEvaluation: false,
            condition: c(17),
            spField: 'gamin',
          }),
          q.radio(18, undefined, 'Ar galite nurodyti importuotoją?', {
            riskEvaluation: false,
            options: [os('Taip', '18.1'), os('Ne', 19)],
            dynamicFields: [
              {
                condition: {
                  question: 4,
                  valueIndex: 0,
                },
                values: {
                  title: 'Ar galite nurodyti tiekėją',
                },
              },
              {
                condition: {
                  question: 4,
                  valueIndex: 0,
                },
                values: {
                  title: 'Ar galite nurodyti tiekėją',
                },
              },
            ],
          }),
          q.input('18.1', 19, 'Produkto importuotojas', {
            condition: c(18),
            dynamicFields: [
              {
                condition: {
                  question: 4,
                  valueIndex: 0,
                },
                values: {
                  title: 'Produkto tiekėjas',
                },
              },
              {
                condition: {
                  question: 4,
                  valueIndex: 0,
                },
                values: {
                  title: 'Produkto tiekėjas',
                },
              },
            ],
            spField: 'tikejas',
          }),
          q.radio(19, undefined, 'Ar galite nurodyti produkto tinkamumo vartoti terminą?', {
            riskEvaluation: false,
            options: [os('Taip', '19.1'), os('Ne', '21.0')],
          }),
          q.date('19.1', '21.0', 'Nurodykite produktų tinkamumo vartoti terminą', {
            riskEvaluation: false,
            spField: 'tink_term',
            condition: c(19),
          }),
          q.input(20, '21.0', 'Nurodykite patiekalo pavadinimą', {
            riskEvaluation: false,
            dynamicFields: [
              ...dm(4, [2], {
                required: false,
              }),
            ],
            spField: 'pavad',
          }),
        ],
      },

      // =======================================
      {
        title: 'Veiklos informacija',
        description: 'Pateikite papildomą informaciją',
        dynamicFields: [
          ...dm(4, [0, 1], {
            title: 'Informacija apie prekybos vietą',
          }),
          ...dm(4, [2], {
            title: 'Informacija apie paslaugų tiekimo vietą',
          }),
        ],
        questions: [
          ...AddressHelper('21.0', 21, {
            dynamicFields: [
              ...dm(4, [2, 3], {
                condition: false,
              }),
            ],
          }),
          q.input(21, 22, 'Nurodykite prekybos vietos adresą (sav., gyv., gatvė, namas, butas)', {
            riskEvaluation: false,
            dynamicFields: [
              ...dm(4, [0, 1], {
                condition: false,
              }),
            ],
            spField: 'adresas',
          }),
          q.input(22, 23, 'Nurodykite veiklos pavadinimą', {
            riskEvaluation: false,
            dynamicFields: [
              ...dm(4, [0, 1], {
                title: 'Nurodykite prekybos vietos pavadinimą',
              }),
              ...dm(4, [2], {
                title: 'Nurodykite paslaugų suteikimo vietos pavadinimą',
              }),
            ],
            spField: 'veik_pav',
          }),
          q.input(
            23,
            24,
            'Nurodykite papildomą informaciją apie veiklą vykdančius fizinius ar juridinius asmenis',
            {
              riskEvaluation: false,
              required: true,
              spField: 'veik_asm',
            },
          ),
          q.input(24, 25, 'Jei galite, nurodykite prekybos vietos darbo laiką', {
            riskEvaluation: false,
            required: false,
            spField: 'darbo_laik',
          }),
        ],
      },

      // =======================================
      pages.aplinkybes(25),

      // =======================================
      {
        ...pages.vaizdine(26),
        description:
          'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus. Pvz: įsigijimo čekis, produkto nuotraukos, ženklinimo informacija ir pan.',
      },

      // =======================================
      pages.teises(28),
    ],
  },

  // SURVEY 2
  {
    title: 'Pašarų ar veterinarijos vaistų pranešimas',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M23.6253 46.1248L46.1253 23.6248C47.1766 22.5944 48.0133 21.3659 48.5869 20.0102C49.1605 18.6545 49.4597 17.1985 49.4672 15.7265C49.4746 14.2544 49.1901 12.7955 48.6302 11.4341C48.0703 10.0726 47.2461 8.83572 46.2052 7.79481C45.1643 6.75391 43.9274 5.92967 42.5659 5.36978C41.2045 4.80988 39.7456 4.52542 38.2736 4.53286C36.8015 4.54029 35.3455 4.83947 33.9898 5.41309C32.6341 5.98671 31.4056 6.8234 30.3753 7.87476L7.87525 30.3748C6.82389 31.4051 5.9872 32.6336 5.41358 33.9893C4.83996 35.345 4.54078 36.801 4.53335 38.2731C4.52591 39.7451 4.81037 41.204 5.37026 42.5655C5.93016 43.9269 6.75439 45.1638 7.7953 46.2047C8.83621 47.2456 10.0731 48.0699 11.4346 48.6298C12.796 49.1897 14.2549 49.4741 15.727 49.4667C17.199 49.4592 18.655 49.1601 20.0107 48.5864C21.3664 48.0128 22.5949 47.1761 23.6253 46.1248Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M19.125 19.125L34.875 34.875" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
    `,
    spList: process.env.SP_LIST,
    authType: SurveyAuthType.OPTIONAL,
    description:
      'Pranešimai apie pašarus ir veterinarinius vaistus, jų kokybės, saugos, ženklinimo ir kitus pažeidimus, nelegalią šių produktų gamybą, tiekimą. Pranešimai apie pašarų ir veterinarinės farmacijos ūkio subjektų veiklos pažeidimus.',
    pages: [
      // =======================================
      pages.kontaktiniai(3),

      // =======================================
      {
        ...pages.tema(),
        questions: [
          q.select(4, undefined, 'Pasirinkite dėl ko pranešate', {
            riskEvaluation: false,
            spField: 'pran_tip',
            options: [
              os('Dėl įsigytų pašarų', 5), // 0
              os('Dėl pastebėtų prekybos vietoje pašarų', 6), // 1
              os('Dėl įsigytų veterinarinių vaistų', 5), // 2
              os('Dėl pastebėtų prekybos vietoje veterinarinių vaistų', 6), // 3
              os('Dėl pašarų gamybos veiklos', '5.0.pre'), // 4
              os('Dėl pašarų prekybos veiklos', '5.0.pre'), // 5
              os('Dėl veterinarinių vaistų gamybos veiklos', '5.0.pre'), // 6
              os('Dėl veterinarinių vaistų prekybos veiklos', '5.0.pre'), // 7
            ],
          }),
        ],
      },

      // =======================================
      {
        ...pages.detales(),
        dynamicFields: [
          {
            condition: {
              question: 4,
              valueIndex: 0,
            },
            values: {
              title: 'Informacija apie produktą',
            },
          },
          {
            condition: {
              question: 4,
              valueIndex: 1,
            },
            values: {
              title: 'Informacija apie produktą',
            },
          },
          {
            condition: {
              question: 4,
              valueIndex: 2,
            },
            values: {
              title: 'Informacija apie produktą',
            },
          },
          {
            condition: {
              question: 4,
              valueIndex: 3,
            },
            values: {
              title: 'Informacija apie produktą',
            },
          },
        ],
        questions: [
          q.date('5.0.pre', '5.0', 'Nurodykite pažeidimų pastebėjimo datą', {
            spField: 'ivykio_data',
          }),
          q.multiselect('5.0', '12.0', 'Nurodykite kokius veiklos pažeidimus pranešate', {
            spField: 'paz_tip5',
            riskEvaluation: false,
            options: o([
              'Kiti pažeidimai', // 0
              'Kokybės pažeidimai', // 1
              'Neleistinos sudedamosios dalys', // 2
              'Neregistruotas veterinarinis vaistas', // 3
              'Neregistruoti veterinariniai vaistai', // 4
              'Netinkamai pildomi veiklos dokumentai', // 5
              'Netinkamai tvarkomos atliekos', // 6
              'Netinkamos laikymo sąlygos', // 7
              'Netinkamos produktų laikymo sąlygos', // 8
              'Patalpos nehigieniškos, neatitinka nustatytų reikalavimų', // 9
              'Prekiaujama neleistinais produktais', // 10
              'Produktas užterštas cheminiais, fiziniais, mikrobiniais ar kitokiais teršalais', // 11
              'Reklamos pažeidimai', // 12
              'Tinkamumo vartoti terminų pažeidimai', // 13
              'Vykdoma veikla be leidimų/registracijos', // 14
              'Ženklinimo pažeidimai', // 15
            ]),
            dynamicFields: [
              ...dm(4, [0], {
                options: [1, 15, 13, 2, 10, 11, 7, 12, 0],
              }),
              ...dm(4, [1], {
                options: [1, 15, 13, 2, 10, 11, 7, 12, 0],
              }),
              ...dm(4, [2], {
                options: [15, 13, 2, 3, 10, 7, 12, 0],
              }),
              ...dm(4, [3], {
                options: [15, 13, 2, 3, 10, 7, 12, 0],
              }),
              ...dm(4, [4], {
                options: [14, 8, 9, 6, 5, 15, 13, 2, 0],
              }),
              ...dm(4, [5], {
                options: [14, 8, 9, 6, 5, 15, 13, 2, 12, 0],
              }),
              ...dm(4, [6], {
                options: [14, 8, 9, 6, 5, 15, 13, 2, 4, 0],
              }),
              ...dm(4, [7], {
                options: [14, 8, 9, 6, 5, 15, 13, 2, 4, 12, 0],
              }),
            ],
          }),
          q.date(5, 6, 'Nurodykite produktų įsigijimo datą', {
            spField: 'ivykio_data',
            dynamicFields: [
              {
                condition: {
                  question: 4,
                  valueIndex: 0,
                },
                values: {
                  title: 'Nurodykite pašarų įsigijimo datą',
                },
              },
              {
                condition: {
                  question: 4,
                  valueIndex: 2,
                },
                values: {
                  title: 'Nurodykite veterinarinių vaistų įsigijimo datą',
                },
              },
            ],
          }),
          q.date(6, 7, 'Nurodykite produktų pastebėjimo prekybos vietoje datą', {
            spField: 'ivykio_data',
            dynamicFields: [
              ...dm(4, [1], {
                title: 'Nurodykite pašarų pastebėjimo prekybos vietoje datą',
              }),
              ...dm(4, [3], {
                title: 'Nurodykite veterinarinių vaistų pastebėjimo prekybos vietoje datą',
              }),
              ...dm(4, [0, 2], {
                condition: false,
              }),
            ],
          }),
          q.multiselect(7, 8, 'Pasirinkite apie kokius pažeidimus pranešate', {
            spField: 'paz_tip5',
            options: o([
              'Kiti pažeidimai', // 0
              'Kokybės pažeidimai', // 1
              'Neleistinos sudedamosios dalys', // 2
              'Neregistruotas veterinarinis vaistas', // 3
              'Neregistruoti veterinariniai vaistai', // 4
              'Netinkamai pildomi veiklos dokumentai', // 5
              'Netinkamai tvarkomos atliekos', // 6
              'Netinkamos laikymo sąlygos', // 7
              'Netinkamos produktų laikymo sąlygos', // 8
              'Patalpos nehigieniškos, neatitinka nustatytų reikalavimų', // 9
              'Prekiaujama neleistinais produktais', // 10
              'Produktas užterštas cheminiais, fiziniais, mikrobiniais ar kitokiais teršalais', // 11
              'Reklamos pažeidimai', // 12
              'Tinkamumo vartoti terminų pažeidimai', // 13
              'Vykdoma veikla be leidimų/registracijos', // 14
              'Ženklinimo pažeidimai', // 15
            ]),
            dynamicFields: [
              ...dm(4, [0], {
                options: [1, 15, 13, 2, 10, 11, 7, 12, 0],
              }),
              ...dm(4, [1], {
                options: [1, 15, 13, 2, 10, 11, 7, 12, 0],
              }),
              ...dm(4, [2], {
                options: [15, 13, 2, 3, 10, 7, 12, 0],
              }),
              ...dm(4, [3], {
                options: [15, 13, 2, 3, 10, 7, 12, 0],
              }),
              ...dm(4, [4], {
                options: [14, 8, 9, 6, 5, 15, 13, 2, 0],
              }),
              ...dm(4, [5], {
                options: [14, 8, 9, 6, 5, 15, 13, 2, 12, 0],
              }),
              ...dm(4, [6], {
                options: [14, 8, 9, 6, 5, 15, 13, 2, 4, 0],
              }),
              ...dm(4, [7], {
                options: [14, 8, 9, 6, 5, 15, 13, 2, 4, 12, 0],
              }),
            ],
          }),
          q.input(8, 9, 'Nurodykite produkto pavadinimą', {
            spField: 'pavad',
            riskEvaluation: false,
            hint: 'Nurodykite tikslų produkto pavadinimą (pvz. varškės sūrelis "XXXX")',
            dynamicFields: [
              ...dm(4, [0, 1], {
                title: 'Nurodykite pašaro pavadinimą',
                hint: 'Nurodykite tikslų pašaro pavadinimą (pvz. sausas šunų maistas „XXX“)',
              }),
              ...dm(4, [2, 3], {
                title: 'Nurodykite veterinarinio vaisto pavadinimą',
                hint: 'Nurodykite tikslų veterinarinio vaisto pavadinimą (pvz. ampulės „XXX“)',
              }),
            ],
          }),
          q.radio(9, undefined, 'Ar galite nurodyti gamintoją?', {
            riskEvaluation: false,
            options: [os('Taip', '9.1'), os('Ne', 10)],
          }),
          q.input('9.1', 10, 'Produkto gamintojas', {
            spField: 'gamin',
            riskEvaluation: false,
            condition: c(9),
          }),

          q.radio(10, undefined, 'Ar galite nurodyti importuotoją?', {
            riskEvaluation: false,
            options: [os('Taip', '10.1'), os('Ne', 11)],
            dynamicFields: [
              ...dm(4, [0, 1, 2, 3], {
                title: 'Ar galite nurodyti tiekėją?',
              }),
              ...dm(4, [4, 5, 6, 7], {
                condition: false,
              }),
            ],
          }),
          q.input('10.1', 11, 'Produkto importuotojas', {
            riskEvaluation: false,
            condition: c(10),
            spField: 'tikejas',
            dynamicFields: [
              ...dm(4, [0, 1, 2, 3], {
                title: 'Produkto tiekėjas',
              }),
              ...dm(4, [4, 5, 6, 7], {
                condition: false,
              }),
            ],
          }),

          q.date(11, '12.0', 'Nurodykite produktų tinkamumo vartoti terminą', {
            riskEvaluation: false,
            spField: 'tink_term',
            dynamicFields: [
              ...dm(4, [0, 1], {
                title: 'Nurodykite pašarų tinkamumo vartoti terminą',
              }),
              ...dm(4, [2, 3], {
                title: 'Nurodykite veterinarinių vaistų tinkamumo vartoti terminą',
                required: false,
              }),
            ],
          }),
        ],
      },

      // =======================================
      {
        title: 'Veiklos informacija',
        description: 'Pateikite papildomą informaciją',
        dynamicFields: [
          ...dm(4, [0, 1, 2, 3], {
            title: 'Informacija apie prekybos vietą',
          }),
        ],
        questions: [
          ...helperVeiklos('12.0', 12, {
            dynamicFields: [
              ...dm(4, [4, 5, 6, 7], {
                condition: false,
              }),
            ],
          }),
          q.location(12, 13, '', {
            riskEvaluation: false,
            spField: 'koord',
            dynamicFields: [
              ...dm(4, [4, 5, 6, 7], {
                title: 'Žemėlapyje nurodykite veiklos vykdymo vietą',
              }),
              ...dm(4, [0, 1, 2, 3], {
                condition: false,
              }),
            ],
          }),
          q.input(13, 14, 'Nurodykite veiklos pavadinimą', {
            riskEvaluation: false,
            spField: 'veik_pav',
            dynamicFields: [
              ...dm(4, [0, 1, 2, 3], {
                title: 'Nurodykite prekybos vietos pavadinimą',
              }),
            ],
          }),
          q.input(14, 15, 'Nurodykite veiklą vykdančius fizinius ar juridinius asmenis', {
            riskEvaluation: false,
            required: false,
            spField: 'veik_asm',
          }),
        ],
      },

      // =======================================
      pages.aplinkybes(15),

      // =======================================
      {
        ...pages.vaizdine(16),
        description:
          'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus. Pvz: įsigijimo čekis, produkto nuotraukos, ženklinimo informacija ir pan.',
      },

      // =======================================
      pages.teises(18),
    ],
  },

  // SURVEY 3
  {
    title: 'Veterinarinės srities pranešimų anketa',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M25.084 13.5C27.5693 13.5 29.584 11.4853 29.584 9C29.584 6.51472 27.5693 4.5 25.084 4.5C22.5987 4.5 20.584 6.51472 20.584 9C20.584 11.4853 22.5987 13.5 25.084 13.5Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M40.834 22.5C43.3193 22.5 45.334 20.4853 45.334 18C45.334 15.5147 43.3193 13.5 40.834 13.5C38.3487 13.5 36.334 15.5147 36.334 18C36.334 20.4853 38.3487 22.5 40.834 22.5Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M45.334 40.5C47.8193 40.5 49.834 38.4853 49.834 36C49.834 33.5147 47.8193 31.5 45.334 31.5C42.8487 31.5 40.834 33.5147 40.834 36C40.834 38.4853 42.8487 40.5 45.334 40.5Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M20.5839 22.5C22.0613 22.5 23.5242 22.791 24.8891 23.3564C26.254 23.9217 27.4942 24.7504 28.5389 25.795C29.5835 26.8397 30.4122 28.0799 30.9776 29.4448C31.5429 30.8097 31.8339 32.2726 31.8339 33.75V41.625C31.8333 43.507 31.1587 45.3266 29.9323 46.7542C28.7058 48.1818 27.0087 49.1229 25.1482 49.4071C23.2878 49.6914 21.3871 49.2999 19.7903 48.3036C18.1936 47.3074 17.0064 45.7723 16.4439 43.9763C15.4839 40.8788 13.4589 38.85 10.3689 37.89C8.57382 37.3278 7.03928 36.1415 6.04297 34.546C5.04666 32.9504 4.65439 31.0509 4.93715 29.1912C5.21992 27.3315 6.15903 25.6345 7.58455 24.4071C9.01007 23.1798 10.8278 22.5033 12.7089 22.5H20.5839Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
    spList: process.env.SP_LIST,
    authType: SurveyAuthType.OPTIONAL,
    description:
      'Pranešimai apie gyvūnų gerovės pažeidimus, veterinarijos paslaugų teikėjų pažeidimus teisės aktų reikalavimams ar pranešimai apie nelegaliai vykdomą veterinarinę veiklą.',
    pages: [
      // =======================================
      pages.kontaktiniai(4),

      // =======================================
      {
        ...pages.tema(),
        questions: [
          q.select(5, undefined, 'Pasirinkite dėl ko pranešate', {
            spField: 'pran_tip',
            riskEvaluation: false,
            options: [
              os('Dėl gyvūnų gerovės', '4.6'), // 0
              os('Dėl gyvūnų augintinių veisimo veiklos', '4.10'), // 1
              os('Dėl gyvūnų augintinių prekybos veiklos', '4.10'), // 2
              os('Dėl ūkinių gyvūnų prekybos veiklos', '4.11'), // 3
              os('Dėl gyvūnų transportavimo veiklos', '4.13'), // 4
              os(
                'Dėl medžiojimo veiklos (veterinarinė priežiūra medžioklėje, pirminio apdorojimo aikštelės/patalpos, gyvūninių atliekų duobės)',
                '4.13',
              ), // 5
              os('Dėl šalutinių gyvūninių produktų tvarkymo veiklos', '4.13'), // 6
              os('Dėl ūkininkavimo veiklos', '4.13'), // 7
              os('Dėl veterinarinių paslaugų veiklos', '4.13'), // 8
              os('Dėl kitos veterinarinės veiklos', '4.13'), // 9
            ],
          }),
        ],
      },

      // =======================================
      {
        ...pages.detales(),
        questions: [
          q.date('4.6', 6, 'Nurodykite pranešamo įvykio datą', {
            spField: 'ivykio_data',
          }),
          q.date('4.10', 10, 'Nurodykite pranešamo įvykio datą', {
            spField: 'ivykio_data',
          }),
          q.date('4.11', 11, 'Nurodykite pranešamo įvykio datą', {
            spField: 'ivykio_data',
          }),
          q.date('4.13', 13, 'Nurodykite pranešamo įvykio datą', {
            spField: 'ivykio_data',
          }),

          q.multiselect(6, undefined, 'Pasirinkite gyvūno tipą', {
            spField: 'gyv_tip',
            riskEvaluation: false,
            options: [
              os('Ūkiniai gyvūnai', 8),
              os('Gyvūnai augintiniai', 7),
              os('Laukiniai gyvūnai', 9),
            ],
          }),

          q.multiselect(7, undefined, 'Pasirinkite gyvūno augintinio rūšį', {
            spField: 'aug',
            riskEvaluation: false,
            options: [
              os('Šunys', 12),
              os('Katės', 12),
              os('Šeškai', 12),
              os('Graužikai', 12),
              os('Ropliai', 12),
              os('Paukščiai', 12),
              os('Kita', '7.1'),
            ],
            condition: c(6),
          }),

          q.input('7.1', 12, 'Įveskite gyvūno augintinio rūšį', {
            riskEvaluation: false,
            condition: c(7),
            spField: 'aug_kt',
          }),

          q.multiselect(8, undefined, 'Pasirinkite ūkinio gyvūno rūšį', {
            condition: c(6),
            riskEvaluation: false,
            options: [
              os('Galvijai', 12),
              os('Arkliai', 12),
              os('Avys', 12),
              os('Ožkos', 12),
              os('Kiaulės', 12),
              os('Paukščiai', 12),
              os('Bitės', 12),
              os('Kita', '8.1'),
            ],
            spField: 'ukin',
          }),

          q.input('8.1', 12, 'Įveskite ūkinio gyvūno rūšį', {
            riskEvaluation: false,
            condition: c(8),
            spField: 'ukin_kt',
          }),

          q.input(9, 12, 'Nurodykite laukinio gyvūno rūšį', {
            riskEvaluation: false,
            condition: c(6),
            spField: 'lauk',
          }),

          q.multiselect(10, undefined, 'Pasirinkite gyvūno augintinio rūšį', {
            spField: 'aug',
            riskEvaluation: false,
            options: [
              os('Šunys', 13),
              os('Katės', 13),
              os('Šeškai', 13),
              os('Graužikai', 13),
              os('Ropliai', 13),
              os('Paukščiai', 13),
              os('Kita', '10.1'),
            ],
          }),

          q.input('10.1', 13, 'Įveskite gyvūno augintinio rūšį', {
            spField: 'aug_kt',
            riskEvaluation: false,
            condition: c(10),
          }),

          q.multiselect(11, undefined, 'Pasirinkite ūkinio gyvūno rūšį', {
            riskEvaluation: false,
            spField: 'ukin',
            options: [
              os('Galvijai', 13),
              os('Arkliai', 13),
              os('Avys', 13),
              os('Ožkos', 13),
              os('Kiaulės', 13),
              os('Paukščiai', 13),
              os('Bitės', 13),
              os('Kita', '11.1'),
            ],
          }),

          q.input('11.1', 13, 'Įveskite ūkinio gyvūno rūšį', {
            spField: 'ukin_kt',
            riskEvaluation: false,
            condition: c(11),
          }),

          q.multiselect(12, 14, 'Pasirinkite apie kokius gyvūnų gerovės pažeidimus pranešate', {
            options: o([
              'Gyvūno žalojimas, keliantis grėsmę jo gyvybei arba gyvūno nužudymas',
              'Gyvūno mušimas ar kiti smurtiniai veiksmai, keliantys grėsmę jo sveikatai, bet ne gyvybei',
              'Sąmoningas gyvūno išmetimas ar palikimas be priežiūros (beglobiu)',
              'Netinkamos laikymo sąlygos (mažas narvas, netinkama aplinka, grandinė ir pan.)',
              'Laikymo sąlygos, keliančios grėsmę gyvūno sveikatai ar gyvybei',
              'Gyvūnui nesuteikiama būtina veterinarinė pagalba',
              'Neatlikta privaloma vakcinacija (pvz., nuo pasiutligės)',
              'Gyvūnas nėra tinkamai paženklintas ar registruotas',
              'Gyvūnas nepakankamai šeriamas (maisto trūkumas, netinkamas maistas)',
              'Gyvūnui nesuteikiamas prieinamumas prie švaraus vandens',
              'Gyvūno keliamas triukšmas',
              'Kiti pažeidimai',
            ]),
            spField: 'paz_tip3',
          }),

          q.multiselect(13, '13.1', 'Pasirinkite apie kokius veiklos pažeidimus pranešate', {
            options: o([
              'Kiti pažeidimai', // 0
              'Laikymo sąlygų keliančių grėsmę gyvūnų sveikatai pažeidimai', // 1
              'Nepakankamas plotas gyvūnų skaičiui', // 2
              'Nepateikiama privalomoji informacija apie vykdomą veiklą', // 3
              'Nesuteikiama reikalinga veterinarinė pagalba', // 4
              'Netinkamai pildomi veiklos dokumentai', // 5
              'Netinkamai tvarkomos atliekos', // 6
              'Netinkamos sveikatos būklės gyvūnai', // 7
              'Neužtikrinami biologinės saugos reikalavimai', // 8
              'Nėra užtikrinama gyvūnų gerovė, gyvūnais nepakankamai rūpinamasi, neužtikrinami jų fiziologiniai poreikiai, gyvūnai kitaip kankinami', // 9
              'Pardavinėjami per jauni gyvūnai', // 10
              'Patalpos nehigieniškos, neatitinka nustatytų reikalavimų', // 11
              'Vakcinacijos pažeidimai', // 12
              'Veikla be galiojančių veterinarijos praktikos licencijų', // 13
              'Vykdoma veikla be leidimų/registracijos', // 14
              'Šėrimo/girdymo pažeidimai', // 15
              'Ženklinimo/registravimo pažeidimai', // 16
            ]),
            spField: 'paz_tip5',
            dynamicFields: [
              ...dm(5, [1], {
                options: [16, 12, 7, 1, 9, 4, 15, 14, 11, 5, 3, 0, 2],
              }),
              ...dm(5, [2], {
                options: [16, 12, 7, 10, 1, 9, 4, 15, 14, 11, 5, 3, 0, 2],
              }),
              ...dm(5, [3], {
                options: [16, 7, 10, 1, 9, 4, 15, 14, 11, 8, 5, 3, 0, 2],
              }),
              ...dm(5, [4], {
                options: [16, 1, 9, 4, 15, 14, 11, 8, 5, 0],
              }),
              ...dm(5, [5], {
                options: [14, 11, 8, 6, 5, 0],
              }),
              ...dm(5, [6], {
                options: [14, 11, 8, 5, 0],
              }),
              ...dm(5, [7], {
                options: [16, 7, 1, 9, 4, 15, 14, 11, 8, 6, 5, 0, 2],
              }),
              ...dm(5, [8], {
                options: [16, 1, 9, 4, 13, 14, 11, 8, 6, 5, 0],
              }),
              ...dm(5, [9], {
                options: [14, 11, 8, 6, 5, 0],
              }),
            ],
          }),

          q.text('13.1', '16.0', 'Nurodykite dėl kokios veiklos pranešate', {
            dynamicFields: [
              ...dm(5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], {
                condition: false,
              }),
            ],
            spField: 'veik_tip',
          }),
        ],
      },

      {
        title: 'Laikymo vietos informacija',
        questions: [
          q.input(
            14,
            '14.1',
            'Nurodykite veiklos vykdymo adresą (sav., gyv., gatvė, namas, butas)',
            {
              riskEvaluation: false,
              spField: 'adresas',
              dynamicFields: [
                ...dm(5, [5], {
                  condition: false,
                }),
              ],
            },
          ),
          q.location('14.1', 15, 'Žemėlapyje nurodykite gyvūno(-ų) laikymo vietą', {
            riskEvaluation: false,
            dynamicFields: [
              ...dm(5, [0, 1, 2, 3, 4, 6, 7, 8, 9], {
                condition: false,
              }),
            ],
          }),

          q.text(
            15,
            '15.5',
            'Nurodykite visą žinomą informaciją apie gyvūno(-ų) laikytojus/globėjus',
            {
              required: true,
              riskEvaluation: false,
              spField: 'laik',
            },
          ),
          q.input(
            '15.5',
            '15.6',
            'Jei galite, pateikite informaciją apie laiką, kuriuo galima rasti globėjus gyvūno(-ų) laikymo vietoje',
            {
              riskEvaluation: false,
              spField: 'darbo_laik',
              required: false,
            },
          ),
          q.text(
            '15.6',
            19,
            'Nurodykite papildomą naudingą informaciją apie patekimą į bendro naudojimo patalpas ar teritoriją.',
            {
              riskEvaluation: false,
              spField: 'patek',
              required: false,
            },
          ),
        ],
      },

      // =======================================
      {
        title: 'Veiklos vietos informacija',
        description: 'Pateikite papildomą informaciją',
        dynamicFields: [
          ...dm(5, [0], {
            title: 'Veiklos informacija',
          }),
        ],
        questions: [
          q.input('16.0', '16.1', 'Nurodykite transporto priemonės valstybinius numerius', {
            dynamicFields: [
              // $ne: 4
              ...dm(5, [0, 1, 2, 3, 5, 6, 7, 8, 9], {
                condition: false,
              }),
            ],
            spField: 'pap_info',
          }),
          ...AddressHelper('16.1', '16.2', {
            dynamicFields: [
              // $ne: 3, 2
              ...dm(5, [0, 1, 4, 5, 6, 7, 8, 9], {
                condition: false,
              }),
            ],
          }),
          q.location('16.2', 16, 'Žemėlapyje nurodykite veiklos vietą', {
            riskEvaluation: false,
            dynamicFields: [
              ...dm(5, [0, 1, 2, 3, 4, 6, 7, 8, 9], {
                condition: false,
              }),
            ],
            spField: 'koord',
          }),
          q.input(16, 17, 'Nurodykite veiklos vykdymo adresą (sav., gyv., gatvė, namas, butas)', {
            spField: 'adresas',
            riskEvaluation: false,
            dynamicFields: [
              ...dm(5, [3, 2, 5], {
                condition: false,
              }),
            ],
          }),
          q.input(17, 18, 'Nurodykite veiklos pavadinimą', {
            spField: 'veik_pav',
            riskEvaluation: false,
            required: true,
            dynamicFields: [
              ...dm(5, [5], {
                title: 'Nurodykite medžioklės plotų vieneto pavadinimą',
              }),
              ...dm(5, [4, 6, 7, 8, 9], {
                required: false,
              }),
            ],
          }),
          q.input(18, 19, 'Nurodykite veiklą vykdančius fizinius ar juridinius asmenis', {
            riskEvaluation: false,
            required: true,
            spField: 'veik_asm',
            dynamicFields: [
              ...dm(5, [5], {
                title: 'Nurodykite pažeidimus vykdančius fizinius asmenis',
              }),
              ...dm(5, [4, 6, 7, 8, 9], {
                required: false,
              }),
            ],
          }),
        ],
      },

      // =======================================
      pages.aplinkybes(19, {
        required: true,
      }),

      // =======================================
      {
        ...pages.vaizdine(20),
        description:
          'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus. Pvz: įsigijimo čekis, produkto nuotraukos, ženklinimo informacija ir pan.',
      },

      // =======================================
      pages.teises(22),
    ],
  },

  // SURVEY 4
  //   {
  //     title: 'Maisto sukeltų protrūkių pranešimas',
  //     icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
  // <path d="M16.417 47.25H38.917" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  // <path d="M27.667 47.25C33.0376 47.25 38.1883 45.1165 41.9859 41.3189C45.7835 37.5213 47.917 32.3706 47.917 27H7.41699C7.41699 32.3706 9.55047 37.5213 13.3481 41.3189C17.1457 45.1165 22.2964 47.25 27.667 47.25Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  // <path d="M26.2716 26.9998C24.9089 27.0125 23.5918 26.5095 22.5845 25.5917C21.5772 24.674 20.9541 23.4093 20.8402 22.0513C20.7263 20.6933 21.1301 19.3425 21.9705 18.2698C22.8109 17.197 24.0259 16.4817 25.3716 16.2673C25.1562 15.3138 25.2036 14.3197 25.5088 13.3911C25.814 12.4624 26.3655 11.634 27.1046 10.9942C27.8437 10.3545 28.7426 9.9273 29.7054 9.75834C30.6682 9.58937 31.6589 9.68492 32.5716 10.0348C32.9713 9.40562 33.4969 8.866 34.1154 8.44991C34.7338 8.03381 35.4317 7.75026 36.1651 7.61711C36.8985 7.48396 37.6515 7.50408 38.3768 7.67622C39.102 7.84835 39.7838 8.16878 40.3791 8.61731C41.4176 7.80106 42.7193 7.39377 44.0379 7.4725C45.3564 7.55122 46.6004 8.1105 47.5344 9.04452C48.4684 9.97854 49.0277 11.2225 49.1064 12.5411C49.1852 13.8596 48.7779 15.1613 47.9616 16.1998C48.4697 16.8747 48.8123 17.6593 48.962 18.4906C49.1117 19.3219 49.0643 20.1768 48.8236 20.9865C48.5829 21.7962 48.1556 22.5381 47.576 23.1526C46.9965 23.7671 46.2808 24.2371 45.4866 24.5248C45.6919 25.3347 45.715 26.18 45.5541 26.9998" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  // <path d="M29.917 27L38.917 18" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  // <path d="M25.1921 16.3125C23.958 14.9969 22.3561 14.0836 20.5953 13.6916C18.8345 13.2996 16.9965 13.4471 15.3208 14.115C13.645 14.7828 12.2094 15.94 11.2009 17.4357C10.1925 18.9314 9.65797 20.6962 9.66711 22.5C9.66711 24.1425 10.1171 25.6725 10.8821 27" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  // </svg>`,
  //     spList: 'master_test',
  //     authType: SurveyAuthType.OPTIONAL,
  //     description:
  //       'Pranešimai apie ligų protrūkius, kurie įtariama, kad sukelti vartojant tam tikrus maisto produktus, taip pat kitus su maisto produktų vartojimu susijusius sveikatos pažeidimus.',
  //     pages: [
  //       // =======================================
  //       pages.kontaktiniai(3),

  //       // =======================================
  //       {
  //         ...pages.detales(),
  //         questions: [
  //           q.date(4, 5, 'Nurodykite produktų ar patiekalų įsigijimo/gavimo datą', {
  //             spField: 'ivykio_data',
  //           }),
  //           q.datetime(
  //             5,
  //             '5.1',
  //             'Nurodykite produkto sukėlusio sveikatos sutrikimus vartojimo datą ir laiką',
  //             {
  //               riskEvaluation: false,
  //               spField: 'vart_data',
  //             },
  //           ),
  //           q.select('5.1', 6, 'Nurodykite vartotų produktų patiekalų rūšį', {
  //             required: true,
  //             spField: 'ProdTipas',
  //             options: o([
  //               'Gyvūninės kilmės produktai/patiekalai',
  //               'Negyvūninės kilmės produktai patiekalai',
  //               'Nealkoholiniai gėrimai',
  //               'Alkoholiniai gėrimai',
  //               'Maisto papildai',
  //               'Specialiosios paskirties maisto produktai',
  //             ]),
  //           }),
  //           q.datetime(6, 7, 'Nurodykite pirmųjų simptomų pasireiškimo datą ir laiką', {
  //             spField: 'simp_data',
  //           }),
  //           q.text(7, 8, 'Nurodykite pasireiškusius simptomus', {
  //             spField: 'simp',
  //           }),
  //           q.radio(8, 9, 'Ar maistas buvo vartojamas organizuotame renginyje?', {
  //             options: o(['Taip', 'Ne']),
  //             spField: 'org_rng',
  //           }),
  //           q.radio(9, undefined, 'Ar kiti jums žinomi asmenys vartojo tą patį maistą?', {
  //             riskEvaluation: false,
  //             options: [os('Taip', 10), os('Ne', 11), os('Nežinau', 11)],
  //             spField: 'pap_asm',
  //           }),
  //           q.radio(
  //             10,
  //             11,
  //             'Ar kitiems jums žinomiems asmenims vartojusiems tą patį maistą taip pat pasireiškė simptomai?',
  //             {
  //               riskEvaluation: false,
  //               options: o(['Taip', 'Ne', 'Nežinau']),
  //               spField: 'sus_asm',
  //             },
  //           ),
  //           q.text(11, 12, 'Nurodykite vartoto maisto pavadinimą', {
  //             riskEvaluation: false,
  //             spField: 'pavad',
  //           }),
  //           q.text(12, 13, 'Nurodykite maisto gamintoją', {
  //             riskEvaluation: false,
  //             spField: 'gamin',
  //           }),
  //           q.date(13, 14, 'Nurodykite produkto tinkamumo vartoti terminą', {
  //             required: false,
  //             riskEvaluation: false,
  //             spField: 'tink_term',
  //           }),
  //         ],
  //       },

  //       // =======================================
  //       {
  //         ...pages.papildoma(),
  //         questions: [
  //           q.location(14, 15, 'Žemėlapyje nurodykite produktų įsigijimo/tiekimo vietą', {
  //             riskEvaluation: false,
  //             spField: 'koord',
  //           }),
  //           q.input(15, 16, 'Nurodykite vietos pavadinimą', {
  //             riskEvaluation: false,
  //             required: false,
  //             spField: 'veik_pav',
  //           }),
  //           q.text(
  //             16,
  //             17,
  //             'Nurodykite už produktų tiekimą/pardavimą atsakingus fizinius ar juridinius asmenis',
  //             {
  //               required: false,
  //               riskEvaluation: false,
  //               spField: 'veik_asm',
  //             },
  //           ),
  //         ],
  //       },

  //       // =======================================
  //       pages.aplinkybes(
  //         17,
  //         {
  //           required: true,
  //         },
  //         [
  //           q.radio(
  //             18,
  //             undefined,
  //             'Ar dėl kilusio sveikatos sutrikdymo kreipėtės į gydymo įstaigą?',
  //             {
  //               riskEvaluation: false,
  //               options: [os('Taip', 19), os('Ne', 20)],
  //               spField: 'kreip_gyd',
  //             },
  //           ),
  //           q.input(19, 20, 'Nurodykite sveikatos priežiūros įstaigos į kurią kreipėtės pavadinimą', {
  //             riskEvaluation: false,
  //             condition: c(18),
  //             spField: 'aplink',
  //           }),
  //         ],
  //       ),

  //       // =======================================
  //       {
  //         ...pages.vaizdine(20),
  //         description:
  //           'Pridėkite vaizdinę medžiagą (nuotraukas, video) arba kitus dokumentus įrodančius pateikiamus pažeidimus. Pvz: įsigijimo čekis, produkto nuotraukos, ženklinimo informacija ir pan.',
  //       },

  //       // =======================================
  //       pages.teises(22),
  //     ],
  //   },

  // SURVEY 5
  {
    title: 'Viešai tiekiamo geriamojo vandens pranešimai',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M34.2 49.5H19.8C18.6841 49.5062 17.6056 49.0975 16.7741 48.3532C15.9425 47.609 15.4172 46.5823 15.3 45.4725L11.25 6.75H42.75L38.6775 45.4725C38.5607 46.5784 38.0386 47.6019 37.2118 48.3457C36.385 49.0894 35.3121 49.5006 34.2 49.5Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M13.5 27C15.4473 25.5395 17.8158 24.75 20.25 24.75C22.6842 24.75 25.0527 25.5395 27 27C28.9473 28.4605 31.3158 29.25 33.75 29.25C36.1842 29.25 38.5527 28.4605 40.5 27" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
    spList: process.env.SP_LIST,
    authType: SurveyAuthType.OPTIONAL,
    description:
      'Pranešimai apie viešai tiekiamo geriamojo vandens neatitikimus kokybės ar saugos normoms.',
    pages: [
      // =======================================
      pages.kontaktiniai(2, {}, [
        q.input(3, 4, 'Prašome nurodyti savo kontaktinį telefono numerį', {
          riskEvaluation: false,
          authRelation: AuthRelation.PHONE,
          spField: 'pran_tel',
        }),
      ]),

      // =======================================
      {
        ...pages.detales(),
        questions: [
          q.date(4, 5, 'Nurodykite pranešamo įvykio datą', {
            riskEvaluation: false,
            spField: 'ivykio_data',
          }),
          q.input(5, 6, 'Nurodykite prekybos vietos adresą (sav., gyv., gatvė, namas, butas)', {
            riskEvaluation: false,
            spField: 'adresas',
          }),
          q.input(
            6,
            7,
            'Nurodykite kontaktus kuriais galime su jumis susisiekti dėl vandens mėginio paėmimo?',
            {
              riskEvaluation: false,
              spField: 'meg_kontak',
            },
          ),
          q.input(7, 8, 'Nurodykite kokiu laiku galima atvykti paimti mėginio?', {
            riskEvaluation: false,
            spField: 'darbo_laik',
          }),
        ],
      },

      // =======================================
      pages.aplinkybes(8, {
        required: true,
      }),

      // =======================================
      pages.vaizdine(9),

      // =======================================
      pages.teises(11),
    ],
  },

  // SURVEY 6
  {
    title: 'Įtarimų dėl gyvūnų ligų pranešimų anketa',
    icon: `<svg viewBox="0 0 55 54" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M15.3418 49.5V43.4925C15.3418 40.32 16.6018 37.26 18.8518 35.01C21.1018 32.76 24.1618 31.5 27.3343 31.5C33.9718 31.5 39.3268 36.8775 39.3268 43.4925V49.5H15.3418Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M44.5918 38.9927V34.4927" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M4.83398 49.5001H15.3415V44.2576L4.83398 39.0151V49.5226V49.5001Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M18.8518 35.01L15.3418 31.5L18.3343 28.5075L16.8268 27" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M15.3418 49.4999C15.3418 47.9024 15.9718 46.3724 17.0968 45.2474C18.2218 44.1224 19.7518 43.4924 21.3268 43.4924C21.3268 40.1849 24.0043 37.4849 27.3343 37.4849C33.9493 37.4849 39.3268 42.8624 39.3268 49.4774H15.3193L15.3418 49.4999Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M49.8336 44.2576C49.8336 41.3551 47.4936 39.0151 44.5911 39.0151C41.6886 39.0151 39.3486 41.3551 39.3486 44.2576V49.5001H44.5911C47.4936 49.5001 49.8336 47.1601 49.8336 44.2576Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M30.1243 19.3277L39.7318 23.5352C42.9268 24.9302 46.6393 23.4677 48.0343 20.2952C49.4293 17.1002 47.9668 13.3877 44.7943 11.9927L35.1868 7.78517C31.9918 6.39017 28.2793 7.85267 26.8843 11.0252C25.4893 14.2202 26.9518 17.9327 30.1243 19.3277Z" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M42.2736 17.7524C41.1261 15.8399 39.2586 15.1874 37.0761 15.6374C35.1411 16.0424 33.5886 15.2099 32.6436 13.5449" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M26.8612 11.025L24.1387 9.85498" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M27.2661 16.8525L24.7461 18.405" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M43.4893 23.9399L44.0743 26.8424" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M48.0342 20.2725L50.7567 21.465" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M47.6289 14.4675L50.1714 12.915" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M31.4063 7.38008L30.8213 4.45508" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M34.9161 21.4873L33.7236 24.2098" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M39.9561 9.78744L41.1486 7.06494" stroke="#2671D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
    spList: process.env.SP_LIST,
    authType: SurveyAuthType.NONE,
    description:
      'Pranešimai apie pastebėtas laukinių gyvūnų gaišenas, galimai susijusias su plintančiomis gyvūnų ligomis, pranešimai apie pastebėtas ūkinių gyvūnų gaišenas.',

    pages: [
      // =======================================
      pages.kontaktiniai(
        1,
        {
          required: true,
          riskEvaluation: false,
          authRelation: null,
        },
        [
          q.input(2, '2.0', 'Prašome nurodyti savo kontaktinį telefono numerį', {
            required: true,
            riskEvaluation: false,
            spField: 'pran_tel',
          }),
        ],
      ),

      // =======================================
      {
        ...pages.detales(),
        questions: [
          q.date('2.0', '3.1', 'Nurodykite pranešamo įvykio datą', {
            spField: 'ivykio_data',
          }),

          q.multiselect('3.1', undefined, 'Pasirinkite gyvūno tipą', {
            riskEvaluation: false,
            spField: 'gyv_tip',
            options: [
              os('Ūkiniai gyvūnai', '3.1.8'),
              os('Gyvūnai augintiniai', '3.1.7'),
              os('Laukiniai gyvūnai', '3.1.9'),
            ],
          }),

          q.multiselect('3.1.7', undefined, 'Pasirinkite gyvūno augintinio rūšį', {
            riskEvaluation: false,
            options: [
              os('Šunys', '3.2'),
              os('Katės', '3.2'),
              os('Šeškai', '3.2'),
              os('Graužikai', '3.2'),
              os('Ropliai', '3.2'),
              os('Paukščiai', '3.2'),
              os('Kita', '3.1.7.1'),
            ],
            condition: c('3.1'),
            spField: 'aug',
          }),

          q.input('3.1.7.1', '3.2', 'Įveskite gyvūno augintinio rūšį', {
            riskEvaluation: false,
            condition: c('3.1.7'),
            spField: 'aug_kt',
          }),

          q.multiselect('3.1.8', undefined, 'Pasirinkite ūkinio gyvūno rūšį', {
            condition: c('3.1'),
            riskEvaluation: false,
            options: [
              os('Galvijai', '3.2'),
              os('Arkliai', '3.2'),
              os('Avys', '3.2'),
              os('Ožkos', '3.2'),
              os('Kiaulės', '3.2'),
              os('Paukščiai', '3.2'),
              os('Bitės', '3.2'),
              os('Kita', '3.1.8.1'),
            ],
            spField: 'ukin',
          }),

          q.input('3.1.8.1', '3.2', 'Įveskite ūkinio gyvūno rūšį', {
            riskEvaluation: false,
            condition: c('3.1.8'),
            spField: 'ukin_kt',
          }),

          q.multiselect('3.1.9', undefined, 'Pasirinkite laukinio gyvūno rūšį', {
            condition: c('3.1'),
            riskEvaluation: false,
            options: [
              os('Paukštis', '3.2'),
              os('Šernas', '3.2'),
              os('Lapė', '3.2'),
              os('Usūrinis šuo', '3.2'),
              os('Kita', '3.1.9.1'),
            ],
            spField: 'lauk',
          }),

          q.input('3.1.9.1', '3.2', 'Įveskite laukinio gyvūno rūšį', {
            riskEvaluation: false,
            condition: c('3.1.9'),
            spField: 'lauk_kt',
          }),

          q.radio('3.2', undefined, 'Pasirinkite apie ką pranešate', {
            riskEvaluation: false,
            options: [os('Gyvūnų gaišenos', 4), os('Gyvūnų ligos', '3.3')],
            spField: 'pran_tip',
          }),

          q.text('3.3', '3.4', 'Aprašykite gyvūno(-ų) simptomatiką', {
            condition: c('3.2'),
            spField: 'simp',
          }),

          q.location('3.4', 5, 'Nurodykite gyvūno(-ų) laikymo vietą', {
            condition: {
              question: '3.2',
              valueIndex: 1,
            },
            riskEvaluation: false,
            spField: 'koord',
          }),

          q.location(4, 5, 'Nurodykite gaišenos radimo vietą', {
            condition: c('3.2'),
            riskEvaluation: false,
            spField: 'koord',
          }),
          q.input(5, 6, 'Nurodykite papildomą informaciją apie vietos adresą', {
            riskEvaluation: false,
            required: false,
            spField: 'pap_adr_info',
          }),
        ],
      },

      // =======================================
      {
        ...pages.papildoma(),
        questions: [
          q.text(6, 7, 'Pateikite papildomą informaciją', {
            riskEvaluation: false,
            spField: 'pap_info',
          }),
        ],
      },

      // =======================================
      {
        ...pages.vaizdine(7),
        questions: [
          q.files(7, undefined, 'Pridėkite vaizdinę ar kitą medžiagą', {
            required: false,
            riskEvaluation: false,
            spField: 'files',
          }),
        ],
      },
    ],
  },
];

@Service({
  name: 'seed',
  mixins: [DbConnection({ collection: 'seed_metadata', rest: false })],
  settings: {
    fields: {
      id: {
        type: 'number',
        columnType: 'integer',
        primaryKey: true,
      },
      key: {
        type: 'string',
        required: true,
      },
      hash: {
        type: 'string',
        required: true,
      },
      version: {
        type: 'string',
      },
      created_at: {
        type: 'date',
      },
      updated_at: {
        type: 'date',
      },
    },
  },
})
export default class SeedService extends moleculer.Service {
  @Method
  async seedSurveys(surveys: SurveyTemplate[]) {
    for (const surveyItem of surveys) {
      const { pages, ...surveyData } = surveyItem;
      const questionByExcelId: Record<string, Partial<Question<'options'>>> = {};
      let firstPage: Page['id'];

      // 1 - first step: create pages with partial questions
      for (const pageItem of pages) {
        const { questions = [], dynamicFields, ...pageData } = pageItem;
        const page: Page = await this.broker.call('pages.create', pageData);
        pageItem.id = page.id;

        firstPage ||= page.id;

        for (const item of questions) {
          const {
            options,
            id: excelId,
            nextQuestion,
            condition,
            dynamicFields,
            ...questionData
          } = item;

          const question: Question = await this.broker.call('questions.create', {
            ...questionData,
            priority: questions.length - questions.indexOf(item),
            page: page.id,
          });

          questionByExcelId[excelId] = question;
        }
      }

      // 2 - second step: create survey
      const survey: Survey = await this.broker.call('surveys.create', {
        ...surveyData,
        priority: surveys.length - surveys.indexOf(surveyItem),
        firstPage,
      });

      // 3 - third step: update questions missing data and options
      for (const { questions = [], id: pageId, dynamicFields } of pages) {
        if (dynamicFields) {
          await this.broker.call('pages.update', {
            id: pageId,
            dynamicFields: dynamicFields.map((df) => ({
              condition: {
                question: questionByExcelId[df.condition.question].id,
                value:
                  df.condition.value !== undefined
                    ? df.condition.value
                    : questionByExcelId[df.condition.question].options[df.condition.valueIndex].id,
              },
              values: df.values,
            })),
          });
        }

        for (const {
          options = [],
          id: excelId,
          nextQuestion,
          condition,
          dynamicFields,
        } of questions) {
          const qOptions: QuestionOption[] = [];
          for (const optionItem of options) {
            const { nextQuestion, ...optionData } = optionItem;
            if (nextQuestion && !questionByExcelId[nextQuestion]) {
              console.error(nextQuestion, survey, excelId);
            }
            const option: QuestionOption = await this.broker.call('questionOptions.create', {
              ...optionData,
              question: questionByExcelId[excelId].id,
              priority: options.length - options.indexOf(optionItem),
              nextQuestion: nextQuestion ? questionByExcelId[nextQuestion].id : undefined,
            });

            qOptions.push(option);
          }

          const question: Question<'options'> = await this.broker.call('questions.update', {
            id: questionByExcelId[excelId].id,
            survey: survey.id,
            nextQuestion: nextQuestion ? questionByExcelId[nextQuestion].id : undefined,
            condition: condition
              ? {
                  question: questionByExcelId[condition.question].id,
                  value:
                    condition.value !== undefined
                      ? condition.value
                      : condition.valueIndex !== undefined
                      ? questionByExcelId[condition.question].options[condition.valueIndex].id
                      : questionByExcelId[condition.question].options.find(
                          (o) => o.nextQuestion === questionByExcelId[excelId].id,
                        ).id,
                }
              : undefined,
            dynamicFields: dynamicFields?.map((df) => {
              const values = df.values;

              for (const field in values) {
                if (field === 'options' && values.options && Array.isArray(values.options)) {
                  // @ts-ignore
                  values.options = (values.options as Array<number>).map((option) => {
                    return qOptions[option].id;
                  });
                }
              }

              return {
                condition: {
                  question: questionByExcelId[df.condition.question].id,
                  value:
                    df.condition.value !== undefined
                      ? df.condition.value
                      : questionByExcelId[df.condition.question].options[df.condition.valueIndex]
                          .id,
                },
                values,
              };
            }),
          });

          question.options = qOptions;

          questionByExcelId[excelId] = question;
        }
      }
    }
  }

  @Method
  async shouldRecreateSeedData(currentHash: string): Promise<boolean> {
    return await this.haveSeedTemplatesChanged(currentHash);
  }

  @Method
  async haveSeedTemplatesChanged(currentHash: string): Promise<boolean> {
    const storedHash = await this.getStoredSeedHash();

    if (currentHash != storedHash) {
      return true;
    }

    return false;
  }

  @Method
  generateSeedHash(surveys: SurveyTemplate[]): string {
    const seedString = JSON.stringify(surveys, null, 0);
    return crypto.createHash('md5').update(seedString).digest('hex');
  }

  @Method
  async getStoredSeedHash(): Promise<string | null> {
    try {
      const metadataRecord = (await this.broker.call('seed.findOne', {
        query: { key: 'surveys.seedHash' },
      })) as any;

      return metadataRecord?.hash || null;
    } catch (error) {
      console.warn('Could not retrieve seed hash from database:', error);
      return null;
    }
  }

  @Method
  async storeSeedHash(hash: string): Promise<void> {
    try {
      const existing = (await this.broker.call('seed.findOne', {
        query: { key: 'surveys.seedHash' },
      })) as any;

      if (existing) {
        await this.broker.call('seed.update', {
          id: existing.id,
          hash,
          version: TEMPLATE_VERSION,
          updated_at: new Date(),
        });
      } else {
        await this.broker.call('seed.create', {
          key: 'surveys.seedHash',
          hash,
          version: TEMPLATE_VERSION,
        });
      }
    } catch (error) {
      console.warn('Could not store seed hash in seed_metadata table:', error);
    }
  }

  @Method
  async recreateSeedData(surveys: SurveyTemplate[]) {
    await this.clearAllSeedData();
    await this.seedSurveys(surveys);
  }

  @Method
  async clearAllSeedData() {
    // Cleared in reverese dependency order
    await this.broker.call('questionOptions.removeAllEntities');
    await this.broker.call('questions.removeAllEntities');
    await this.broker.call('pages.removeAllEntities');
    await this.broker.call('surveys.removeAllEntities');
  }

  @Action({ timeout: 180000 })
  async run() {
    await this.broker.waitForServices(['surveys', 'pages', 'questions', 'questionOptions']);

    if (IS_SEED_REFRESH_ENABLED) {
      const currentHash = this.generateSeedHash(SURVEYS_SEED);
      const shouldRecreate = await this.shouldRecreateSeedData(currentHash);

      if (shouldRecreate) {
        await this.recreateSeedData(SURVEYS_SEED);
        await this.storeSeedHash(currentHash);
        console.log('Seed data recreation is completed');
      } else {
        console.log('Seed template is unchanged, no reseeding required');
      }
    } else {
      const count: number = await this.broker.call('surveys.count');

      if (!count) {
        await this.seedSurveys(SURVEYS_SEED);
      }
    }
  }
}
