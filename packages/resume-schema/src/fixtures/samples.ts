import type { Resume } from "../schema"
import { bullets, fid } from "./build"

/** Basics only. Exercises every "skip empty" branch in the templates. */
export const minimal: Resume = {
  schemaVersion: 1,
  basics: {
    id: "basics",
    name: "Dana Okonjo",
    email: "dana@okonjo.dev",
    links: [],
  },
  sections: [],
}

/** A realistic resume that must fit on one page in every template. */
export const onePage: Resume = {
  schemaVersion: 1,
  basics: {
    id: "basics",
    name: "Mira Halvorsen",
    headline: "Backend engineer, distributed systems",
    email: "mira@halvorsen.io",
    phone: "+47 400 12 345",
    location: "Oslo, Norway",
    links: [
      {
        id: fid("lnk", "gh"),
        label: "github.com/mirah",
        url: "https://github.com/mirah",
      },
      {
        id: fid("lnk", "li"),
        label: "LinkedIn",
        url: "https://linkedin.com/in/mirah",
      },
    ],
    summary:
      "Backend engineer with six years building payment and ledger systems. I like correctness problems and the kind of observability that makes an incident boring.",
  },
  sections: [
    {
      id: fid("sec", "exp"),
      type: "experience",
      title: "Experience",
      items: [
        {
          id: fid("exp", "vipps"),
          kind: "experience",
          company: "Vipps MobilePay",
          role: "Senior Backend Engineer",
          location: "Oslo",
          start: "2022-03",
          end: "present",
          bullets: bullets("v", [
            "Rebuilt the settlement ledger on an append-only event log, cutting month-end reconciliation from 9 hours to 20 minutes.",
            "Introduced idempotency keys across the payment API, removing the duplicate-charge class of incident entirely.",
            "Mentored three engineers through their first on-call rotation.",
          ]),
        },
        {
          id: fid("exp", "schibs"),
          kind: "experience",
          company: "Schibsted",
          role: "Backend Engineer",
          location: "Oslo",
          start: "2019-08",
          end: "2022-02",
          bullets: bullets("s", [
            "Owned the subscription billing service through a migration from monolith to service, with no customer-visible downtime.",
            "Cut p99 checkout latency from 1.8s to 420ms by moving price resolution off the request path.",
          ]),
        },
      ],
    },
    {
      id: fid("sec", "prj"),
      type: "projects",
      title: "Projects",
      items: [
        {
          id: fid("prj", "ledgerkit"),
          kind: "project",
          name: "ledgerkit",
          url: "https://github.com/mirah/ledgerkit",
          start: "2021-04",
          bullets: bullets("p", [
            "Double-entry accounting primitives for Postgres, used by 4 companies in production.",
          ]),
        },
      ],
    },
    {
      id: fid("sec", "edu"),
      type: "education",
      title: "Education",
      items: [
        {
          id: fid("edu", "ntnu"),
          kind: "education",
          school: "NTNU",
          degree: "MSc",
          field: "Computer Science",
          start: "2014-08",
          end: "2019-06",
          bullets: [],
        },
      ],
    },
    {
      id: fid("sec", "skl"),
      type: "skills",
      title: "Skills",
      items: [
        {
          id: fid("skl", "lang"),
          kind: "skills",
          label: "Languages",
          skills: ["Go", "TypeScript", "SQL", "Kotlin"],
        },
        {
          id: fid("skl", "infra"),
          kind: "skills",
          label: "Infrastructure",
          skills: [
            "Postgres",
            "Kafka",
            "Kubernetes",
            "Terraform",
            "OpenTelemetry",
          ],
        },
      ],
    },
  ],
}

const onePageExperience = onePage.sections[0]
if (!onePageExperience)
  throw new Error("onePage must open with an experience section")

/** Long enough that every template needs two pages. */
export const twoPage: Resume = {
  ...onePage,
  sections: [
    {
      ...onePageExperience,
      items: [
        ...onePageExperience.items,
        {
          id: fid("exp", "finn"),
          kind: "experience",
          company: "FINN.no",
          role: "Software Engineer",
          location: "Oslo",
          start: "2017-06",
          end: "2019-07",
          bullets: bullets("f", [
            "Built the search indexing pipeline that keeps 3 million listings within 30 seconds of freshness.",
            "Replaced nightly batch imports with change-data-capture, removing a recurring class of stale-listing complaints.",
            "Wrote the load-testing harness the team still uses before every peak-season release.",
          ]),
        },
        {
          id: fid("exp", "intern"),
          kind: "experience",
          company: "Telenor Research",
          role: "Research Intern",
          location: "Trondheim",
          start: "2016-06",
          end: "2016-08",
          bullets: bullets("t", [
            "Prototyped an anomaly detector for base-station telemetry; the approach shipped the following year.",
          ]),
        },
      ],
    },
    ...onePage.sections.slice(1),
    {
      id: fid("sec", "cus"),
      type: "custom",
      title: "Talks and writing",
      items: [
        {
          id: fid("cus", "talk1"),
          kind: "custom",
          title: "Ledgers are just event logs with opinions",
          subtitle: "JavaZone",
          start: "2023-09",
          bullets: bullets("c", [
            "45-minute talk on modelling money without floating point, to an audience of about 300.",
          ]),
        },
        {
          id: fid("cus", "talk2"),
          kind: "custom",
          title: "Idempotency for people who have been paged at 3am",
          subtitle: "Oslo Backend Meetup",
          start: "2022-11",
          bullets: bullets("c2", [
            "Short talk turned into an internal design guide adopted by four teams.",
          ]),
        },
      ],
    },
  ],
}

/** Bullets near the 2000-character limit, to catch text overflow in templates. */
export const longBullets: Resume = {
  schemaVersion: 1,
  basics: {
    id: "basics",
    name: "Priya Raghunathan",
    headline: "Staff engineer",
    email: "priya@example.org",
    links: [],
  },
  sections: [
    {
      id: fid("sec", "exp"),
      type: "experience",
      title: "Experience",
      items: [
        {
          id: fid("exp", "long"),
          kind: "experience",
          company: "Northwind Logistics",
          role: "Staff Engineer",
          start: "2020-01",
          end: "present",
          bullets: bullets("l", [
            `Led the multi-year replatforming of the dispatch system. ${"This sentence exists to push the bullet toward the schema limit so templates are tested against text that wraps across many lines rather than one or two. ".repeat(7)}`,
            `Owned the routing solver rewrite. ${"The solver had accumulated a decade of special cases, and the rewrite had to preserve every one of them while remaining explainable to the operations team. ".repeat(6)}`,
          ]),
        },
      ],
    },
  ],
}

/** Non-Latin scripts, combining marks, and emoji, to catch font gaps. */
export const unicode: Resume = {
  schemaVersion: 1,
  basics: {
    id: "basics",
    name: "陈雨欣 (Yuxin Chen)",
    headline: "Frontend engineer / 前端工程师",
    email: "yuxin@example.cn",
    location: "上海市, 中国",
    links: [
      {
        id: fid("lnk", "site"),
        label: "个人网站",
        url: "https://yuxin.example.cn",
      },
    ],
    summary:
      "Åse, Ærø, Ångström. Ünüşü. Ελληνικά. Русский. العربية. 日本語。한국어. Résumé naïve façade.",
  },
  sections: [
    {
      id: fid("sec", "exp"),
      type: "experience",
      title: "工作经历 / Experience",
      items: [
        {
          id: fid("exp", "bd"),
          kind: "experience",
          company: "字节跳动 ByteDance",
          role: "高级前端工程师",
          location: "上海",
          start: "2021-04",
          end: "present",
          bullets: bullets("u", [
            "重构了组件库的主题系统，构建时间从 4 分钟降到 40 秒。",
            "Shipped an i18n pipeline covering 12 locales, including right-to-left layouts.",
          ]),
        },
      ],
    },
    {
      id: fid("sec", "skl"),
      type: "skills",
      title: "技能",
      items: [
        {
          id: fid("skl", "core"),
          kind: "skills",
          label: "核心",
          skills: ["TypeScript", "React", "无障碍 a11y", "性能优化"],
        },
      ],
    },
  ],
}
