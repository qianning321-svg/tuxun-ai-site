import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { HistoryProvider } from "@/components/studio/history-cache";

const bootstrapCss = `html,body{margin:0;min-height:100%;background:#080c26;color:#f4f7ff;font-family:Arial,'Microsoft YaHei',sans-serif}*,*:before,*:after{box-sizing:border-box}button,input,textarea,select{font:inherit}button{cursor:pointer}img{max-width:100%;height:auto;object-fit:contain}#root{min-height:100vh;background:#080c26}.mumo-boot-error{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:#080c26;color:#f4f7ff}.mumo-boot-error[hidden]{display:none}.mumo-boot-error__panel{max-width:360px;padding:24px;border:1px solid rgba(110,95,255,.28);border-radius:12px;background:#0b1030;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,.38)}.mumo-boot-error button{margin:12px 4px 0;padding:10px 16px;border:0;border-radius:8px;background:linear-gradient(90deg,#a23cff,#685bff,#368eff);color:#fff}`;
const bootstrapScript = `(function(){var root=document.documentElement;var cssLink=document.getElementById('mumo-main-stylesheet');var overlay=document.getElementById('mumo-boot-error');var hydrationTimer=null;function setStatus(name,value){root.setAttribute(name,value)}function hide(){if(overlay)overlay.hidden=true}function show(message,status){if(!overlay)return;var title=overlay.getElementsByTagName('strong')[0];if(title)title.innerHTML=message;overlay.hidden=false;setStatus('data-mumo-bootstrap-status',status)}function hydrated(){setStatus('data-mumo-hydrated','1');if(hydrationTimer!==null){window.clearTimeout(hydrationTimer);hydrationTimer=null}if(root.getAttribute('data-mumo-bootstrap-status')!=='css-error'){hide();setStatus('data-mumo-bootstrap-status','ok')}}function startHydrationCheck(){if(root.getAttribute('data-mumo-hydrated')==='1'){hydrated();return}function afterLoad(){if(root.getAttribute('data-mumo-hydrated')==='1'){hydrated();return}hydrationTimer=window.setTimeout(function(){if(root.getAttribute('data-mumo-hydrated')!=='1'){show('页面初始化失败，请重新加载','hydration-error')}},12000)}if(document.readyState==='complete'){afterLoad()}else{window.addEventListener('load',afterLoad,false)}}function cssLoaded(){setStatus('data-mumo-css-status','loaded');startHydrationCheck()}function cssFailed(){setStatus('data-mumo-css-status','error');show('页面样式资源加载失败','css-error')}setStatus('data-mumo-css-status','loading');setStatus('data-mumo-bootstrap-status','pending');window.__mumoBootstrapHydrated=hydrated;if(overlay){var buttons=overlay.getElementsByTagName('button');if(buttons[0])buttons[0].onclick=function(){window.location.reload()};if(buttons[1])buttons[1].onclick=function(){hide();setStatus('data-mumo-bootstrap-status','dismissed')}}if(!cssLink){cssFailed();return}if(cssLink.sheet){cssLoaded()}else{cssLink.addEventListener('load',cssLoaded,{once:true});cssLink.addEventListener('error',cssFailed,{once:true})}})();`;

function NotFoundComponent() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="text-center">
        <p className="text-7xl font-bold">404</p>
        <h1 className="mt-4 text-xl font-semibold">页面不存在</h1>
        <Link className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-primary-foreground" to="/">
          返回沐莫首页
        </Link>
      </section>
    </main>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="max-w-md text-center">
        <h1 className="text-xl font-semibold">页面暂时无法加载</h1>
        <p className="mt-2 text-sm text-muted-foreground">沐莫正在重建相关服务，请稍后重试。</p>
        <div className="mt-6 flex justify-center gap-2">
          <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={reset} type="button">
            重试
          </button>
          <Link className="rounded-md border border-border px-4 py-2" to="/">返回首页</Link>
        </div>
      </section>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TuXun AI 图片生成丨【GPT Image 2 Pro 与 Nano Banana】" },
      { name: "description", content: "沐莫为电商创作者提供 AI 商品图生成工具。" },
      { property: "og:title", content: "TuXun AI 图片生成丨【GPT Image 2 Pro 与 Nano Banana】" },
      { property: "og:description", content: "沐莫为电商创作者提供 AI 商品图生成工具。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "TuXun AI 图片生成丨【GPT Image 2 Pro 与 Nano Banana】" },
      { name: "twitter:description", content: "沐莫为电商创作者提供 AI 商品图生成工具。" },
    ],
    links: [
      { rel: "stylesheet", href: appCss, id: "mumo-main-stylesheet" },
      { rel: "icon", type: "image/png", href: "/mumo-logo.png" },
    ],
    styles: [{ children: bootstrapCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
        <div id="mumo-boot-error" className="mumo-boot-error" hidden role="alert" aria-live="assertive">
          <div className="mumo-boot-error__panel">
            <strong>页面资源加载失败</strong>
            <p>请检查网络后重试。</p>
            <button type="button">重新加载</button>
            <button type="button">继续尝试进入</button>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: bootstrapScript }} />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    document.documentElement.setAttribute("data-mumo-hydrated", "1");
    const bootstrap = window as typeof window & { __mumoBootstrapHydrated?: () => void };
    bootstrap.__mumoBootstrapHydrated?.();
    const preventFileDrop = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", preventFileDrop);
    window.addEventListener("drop", preventFileDrop);
    return () => {
      window.removeEventListener("dragover", preventFileDrop);
      window.removeEventListener("drop", preventFileDrop);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <HistoryProvider>
          <Outlet />
          <Toaster richColors theme="dark" position="top-center" />
        </HistoryProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
