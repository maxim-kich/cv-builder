export interface LinkValue {
  label: string;
  url: string;
}

export interface ContactDetails {
  address: string;
  email: LinkValue;
  phone: LinkValue;
  links: LinkValue[];
}

export interface RichTextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface RichTextBlock {
  type: "paragraph" | "bullet";
  spans: RichTextSpan[];
}

export interface EmploymentEntry {
  title: string;
  dates: string;
  location: string;
  description: RichTextBlock[];
}

export interface EducationEntry {
  institution: string;
  dates: string;
  location: string;
  descriptions: string[];
  details: string[];
}

export interface LanguageEntry {
  name: string;
  value: number;
  maximum: number;
}

export interface ResumeData {
  name: string;
  professionalTitle: string;
  contact: ContactDetails;
  profile: string[];
  employment: EmploymentEntry[];
  education: EducationEntry[];
  skills: string[];
  languages: LanguageEntry[];
}
