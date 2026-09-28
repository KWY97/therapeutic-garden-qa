import config from "./playwright.config";

// dotenv is loaded by the shared config. Never silently use the local fallback.
if (!process.env.BASE_URL) throw new Error("Production QA에는 BASE_URL 환경변수가 필요합니다.");
const url = new URL(process.env.BASE_URL);
if (!['http:', 'https:'].includes(url.protocol)
  || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  || url.username || url.password) {
  throw new Error("Production QA에는 인증정보 없는 원격 HTTP(S) BASE_URL을 지정하세요.");
}
export default {
  ...config,
  projects: config.projects!.filter(project => project.name === "readonly"),
};
