import {
  Circle,
  Document,
  Font,
  Link,
  Page,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { EducationEntry, EmploymentEntry, LanguageEntry, ResumeData, RichTextSpan } from "../types";

const FONT_BASE = typeof window === "undefined" ? `${process.cwd()}/public/fonts` : "/fonts";

Font.register({
  family: "Arimo",
  fonts: [
    { src: `${FONT_BASE}/Arimo-Regular.ttf`, fontWeight: 400, fontStyle: "normal" },
    { src: `${FONT_BASE}/Arimo-Bold.ttf`, fontWeight: 700, fontStyle: "normal" },
    { src: `${FONT_BASE}/Arimo-Italic.ttf`, fontWeight: 400, fontStyle: "italic" },
    { src: `${FONT_BASE}/Arimo-BoldItalic.ttf`, fontWeight: 700, fontStyle: "italic" },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const PAGE_WIDTH = 595.28;
const OUTER_MARGIN = 45;
const MAIN_X = 196.584;
const SIDE_WIDTH = MAIN_X - OUTER_MARGIN;
const MAIN_WIDTH = PAGE_WIDTH - OUTER_MARGIN - MAIN_X;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Arimo",
    fontSize: 8.45,
    color: "#5f5f5f",
    paddingTop: 30,
    paddingRight: OUTER_MARGIN,
    paddingBottom: 15,
    paddingLeft: OUTER_MARGIN,
    lineHeight: 1.38,
  },
  decoration: {
    position: "absolute",
    top: 43,
    right: 45,
    width: 15,
    height: 15,
    backgroundColor: "#050505",
  },
  name: { color: "#050505", fontSize: 29.8, fontWeight: 700, lineHeight: 1.08 },
  professionalTitle: {
    color: "#050505",
    fontSize: 12.4,
    fontWeight: 700,
    lineHeight: 1.2,
    marginTop: 7.5,
  },
  contact: { flexDirection: "row", marginTop: 49, color: "#505050" },
  contactGroup: { width: 252.64 },
  contactRow: { flexDirection: "row", minHeight: 14.94 },
  contactLabel: { width: 82, color: "#050505", fontSize: 7.45, fontWeight: 700 },
  contactValue: { fontSize: 7.95, lineHeight: 1.15, color: "#505050" },
  contactLink: { color: "#111111", textDecoration: "underline" },
  contactPlainLink: { color: "#505050", textDecoration: "none" },
  contactLinks: { flexDirection: "row" },
  contactSeparator: { color: "#111111", fontSize: 7.95 },
  sectionRow: { flexDirection: "row" },
  profileRow: { marginTop: 29 },
  sectionHeaderRow: { marginTop: 22 },
  sectionSide: { width: SIDE_WIDTH },
  sectionMain: { width: MAIN_WIDTH },
  sectionHeading: {
    alignSelf: "flex-start",
    color: "#050505",
    fontSize: 11.5,
    fontWeight: 700,
    lineHeight: 1.25,
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: "#050505",
  },
  paragraph: { fontSize: 8.45, lineHeight: 1.48, marginBottom: 9 },
  entry: { marginTop: 12 },
  entryHeader: { flexDirection: "row", alignItems: "baseline" },
  entryContentRow: { flexDirection: "row" },
  entrySpacer: { width: SIDE_WIDTH },
  date: {
    width: SIDE_WIDTH,
    paddingRight: 14,
    color: "#050505",
    fontSize: 7.45,
    fontWeight: 700,
    lineHeight: 1.4,
  },
  entryBody: { width: MAIN_WIDTH },
  entryTitle: {
    flexGrow: 1,
    flexShrink: 1,
    color: "#050505",
    fontSize: 10.9,
    fontWeight: 700,
    lineHeight: 1.25,
    paddingRight: 8,
  },
  location: {
    flexShrink: 0,
    maxWidth: 92,
    color: "#050505",
    fontSize: 8,
    fontStyle: "italic",
    lineHeight: 1.3,
    textAlign: "right",
  },
  entryDescription: { fontSize: 8.45, lineHeight: 1.38, marginTop: 7 },
  bulletList: { marginTop: 5, paddingLeft: 13 },
  bulletRow: { flexDirection: "row", marginBottom: 1.5 },
  employmentBulletRow: { flexDirection: "row", marginBottom: 1.5, paddingLeft: 13 },
  bulletGlyph: { width: 9, fontSize: 7.5, lineHeight: 1.45, color: "#5f5f5f" },
  bulletText: { flex: 1, fontSize: 8.45, lineHeight: 1.38 },
  educationEntry: { marginTop: 17 },
  educationSubtitle: { fontSize: 10.1, lineHeight: 1.35, marginTop: 8 },
  skillPair: { width: MAIN_WIDTH, flexDirection: "row" },
  skill: {
    width: MAIN_WIDTH / 2,
    fontSize: 8.9,
    lineHeight: 1.32,
    marginBottom: 6.2,
    paddingRight: 9,
    color: "#111111",
  },
  languagesGrid: { width: MAIN_WIDTH, flexDirection: "row", flexWrap: "wrap" },
  language: {
    width: MAIN_WIDTH / 2,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 9,
    paddingRight: 7,
  },
  languageName: { width: 116, fontSize: 8.9, color: "#111111" },
  languageNameWithoutDots: { width: MAIN_WIDTH / 2 },
  languageDots: { flexDirection: "row", width: 45 },
});

function SectionHeading({ number, children }: { number: string; children: ReactNode }) {
  return <Text style={styles.sectionHeading}>{number} {children}</Text>;
}

function Bullets({ values }: { values: string[] }) {
  if (values.length === 0) return null;
  return (
    <View style={styles.bulletList}>
      {values.map((value, index) => (
        <View key={`${value}-${index}`} style={styles.bulletRow}>
          <Text style={styles.bulletGlyph}>•</Text>
          <Text style={styles.bulletText}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function Employment({ entry }: { entry: EmploymentEntry }) {
  return (
    <View style={styles.entry} wrap={false}>
      <View style={styles.entryHeader}>
        <Text style={styles.date}>{entry.dates}</Text>
        <Text style={styles.entryTitle}>{entry.title}</Text>
        <Text style={styles.location}>{entry.location}</Text>
      </View>
      <View style={styles.entryContentRow}>
        <View style={styles.entrySpacer} />
        <View style={styles.entryBody}>
          {entry.description.map((block, index) => block.type === "bullet" ? (
            <View key={index} style={[styles.employmentBulletRow, index === 0 || entry.description[index - 1]?.type !== "bullet" ? { marginTop: 5 } : {}]}>
              <Text style={styles.bulletGlyph}>•</Text>
              <Text style={styles.bulletText}>{block.spans.map((span, spanIndex) => (
                <RichSpan key={spanIndex} span={span} />
              ))}</Text>
            </View>
          ) : (
            <Text key={index} style={styles.entryDescription}>{block.spans.map((span, spanIndex) => (
              <RichSpan key={spanIndex} span={span} />
            ))}</Text>
          ))}
        </View>
      </View>
    </View>
  );
}

function RichSpan({ span }: { span: RichTextSpan }) {
  return (
    <Text style={{ fontWeight: span.bold ? 700 : 400, fontStyle: span.italic ? "italic" : "normal" }}>
      {span.text}
    </Text>
  );
}

function Education({ entry }: { entry: EducationEntry }) {
  return (
    <View style={styles.educationEntry} wrap={false}>
      <View style={styles.entryHeader}>
        <Text style={styles.date}>{entry.dates}</Text>
        <Text style={styles.entryTitle}>{entry.institution}</Text>
        {entry.location ? <Text style={styles.location}>{entry.location}</Text> : null}
      </View>
      <View style={styles.entryContentRow}>
        <View style={styles.entrySpacer} />
        <View style={styles.entryBody}>
          {entry.descriptions.map((paragraph, index) => (
            <Text key={`${paragraph}-${index}`} style={styles.educationSubtitle}>{paragraph}</Text>
          ))}
          <Bullets values={entry.details} />
        </View>
      </View>
    </View>
  );
}

function LanguageRating({ language, showDots }: { language: LanguageEntry; showDots: boolean }) {
  const filled = Math.round((language.value / language.maximum) * 5);
  return (
    <View style={styles.language} wrap={false}>
      <Text style={[styles.languageName, !showDots ? styles.languageNameWithoutDots : {}]}>{language.name}</Text>
      {showDots ? <View style={styles.languageDots}>
        {Array.from({ length: 5 }, (_, index) => (
          <Svg key={index} width={9.75} height={6} viewBox="0 0 9.75 6">
            <Circle cx={3} cy={3} r={3} fill={index < filled ? "#050505" : "#dedede"} />
          </Svg>
        ))}
      </View> : null}
    </View>
  );
}

export function ResumeDocument({ resume, showLanguageDots = true }: { resume: ResumeData; showLanguageDots?: boolean }) {
  const skillRows = Array.from(
    { length: Math.ceil(resume.skills.length / 2) },
    (_, index) => resume.skills.slice(index * 2, index * 2 + 2),
  );
  return (
    <Document
      title={resume.professionalTitle}
      author={resume.name}
      subject={`${resume.name} résumé`}
      creator="Local React-PDF résumé generator"
      producer="@react-pdf/renderer"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.decoration} />
        <Text style={styles.name}>{resume.name}</Text>
        <Text style={styles.professionalTitle}>{resume.professionalTitle}</Text>
        <View style={styles.contact} wrap={false}>
          <View style={styles.contactGroup}>
            <View style={styles.contactRow}>
              <Text style={styles.contactLabel}>Address</Text>
              <Text style={styles.contactValue}>{resume.contact.address}</Text>
            </View>
            <View style={styles.contactRow}>
              <Text style={styles.contactLabel}>Email</Text>
              <Link src={resume.contact.email.url} style={[styles.contactValue, styles.contactLink]}>
                {resume.contact.email.label}
              </Link>
            </View>
          </View>
          <View style={styles.contactGroup}>
            <View style={styles.contactRow}>
              <Text style={styles.contactLabel}>Phone</Text>
              <Link src={resume.contact.phone.url} style={[styles.contactValue, styles.contactPlainLink]}>
                {resume.contact.phone.label}
              </Link>
            </View>
            <View style={styles.contactRow}>
              <Text style={styles.contactLabel}>Links</Text>
              <View style={styles.contactLinks}>
                {resume.contact.links.map((link, index) => (
                  <View key={link.url} style={styles.contactLinks}>
                    <Link src={link.url} style={[styles.contactValue, styles.contactLink]}>{link.label}</Link>
                    {index < resume.contact.links.length - 1 ? (
                      <Text style={styles.contactSeparator}>, </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.sectionRow, styles.profileRow]} wrap={false}>
          <View style={styles.sectionSide}><SectionHeading number="01">PROFILE</SectionHeading></View>
          <View style={styles.sectionMain}>
            {resume.profile.map((paragraph, index) => (
              <Text key={`${paragraph}-${index}`} style={styles.paragraph}>{paragraph}</Text>
            ))}
          </View>
        </View>

        <View style={[styles.sectionRow, styles.sectionHeaderRow]} wrap={false}>
          <View style={styles.sectionSide}>
            <SectionHeading number="02">EMPLOYMENT HISTORY</SectionHeading>
          </View>
        </View>
        {resume.employment.map((entry, index) => (
          <Employment key={`${entry.title}-${entry.dates}-${index}`} entry={entry} />
        ))}

        <View style={[styles.sectionRow, styles.sectionHeaderRow]} wrap={false}>
          <View style={styles.sectionSide}><SectionHeading number="03">EDUCATION</SectionHeading></View>
        </View>
        {resume.education.map((entry, index) => (
          <Education key={`${entry.institution}-${entry.dates}-${index}`} entry={entry} />
        ))}

        {skillRows.map((row, rowIndex) => (
          <View
            key={`skill-row-${rowIndex}`}
            style={[styles.sectionRow, rowIndex === 0 ? styles.sectionHeaderRow : {}]}
            wrap={false}
          >
            <View style={styles.sectionSide}>
              {rowIndex === 0 ? <SectionHeading number="04">SKILLS</SectionHeading> : null}
            </View>
            <View style={styles.skillPair}>
              {row.map((skill, index) => (
                <Text key={`${skill}-${index}`} style={styles.skill}>{skill}</Text>
              ))}
            </View>
          </View>
        ))}

        <View style={[styles.sectionRow, styles.sectionHeaderRow]} wrap={false}>
          <View style={styles.sectionSide}><SectionHeading number="05">LANGUAGES</SectionHeading></View>
          <View style={styles.languagesGrid}>
            {resume.languages.map((language, index) => (
              <LanguageRating key={`${language.name}-${index}`} language={language} showDots={showLanguageDots} />
            ))}
          </View>
        </View>
      </Page>
    </Document>
  );
}
