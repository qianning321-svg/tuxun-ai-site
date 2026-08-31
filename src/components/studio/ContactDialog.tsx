import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Headphones, Mail, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getContactInfo } from "@/lib/admin.functions";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };
type ContactInfo = { description?: string; wechat?: string; email?: string; serviceHours?: string; enabled?: boolean };

export function ContactDialog({ open, onOpenChange }: Props) {
  const fetchContact = useServerFn(getContactInfo);
  const [contact, setContact] = useState<ContactInfo>({});
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!open) return;
    fetchContact({}).then((value: unknown) => { setContact((value ?? {}) as ContactInfo); setMessage(""); })
      .catch(() => { setContact({}); setMessage("后台数据服务未配置"); });
  }, [open, fetchContact]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mumo-contact-dialog max-w-sm p-6">
        <DialogHeader><div className="mumo-contact-dialog__hero-icon mb-2 flex h-11 w-11 items-center justify-center rounded-2xl border"><Headphones className="h-5 w-5" /></div><DialogTitle className="text-[#f7f8ff]">在线客服</DialogTitle><DialogDescription className="text-[#aab4d3]">{contact.description || message || "如需帮助，请联系我们。"}</DialogDescription></DialogHeader>
        {contact.enabled !== false && !message ? <div className="space-y-2 pt-2"><ContactRow icon={<MessageCircle className="h-4 w-4" />} label="微信客服" value={contact.wechat || "暂未配置"} /><ContactRow icon={<Mail className="h-4 w-4" />} label="邮箱支持" value={contact.email || "暂未配置"} /><p className="px-1 pt-1 text-xs text-[#a8b3d2]">服务时间：{contact.serviceHours || "暂未配置"}</p></div> : <p className="py-8 text-center text-sm text-[#8a96b8]">{message || "客服暂未开放"}</p>}
      </DialogContent>
    </Dialog>
  );
}

function ContactRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const unavailable = value === "暂未配置";
  return <div className="mumo-contact-row flex items-center gap-3 rounded-xl border p-3"><span className="mumo-contact-row__icon flex h-9 w-9 items-center justify-center rounded-xl border">{icon}</span><div><p className="text-sm font-medium text-[#e9edff]">{label}</p><p className={`mt-0.5 text-xs ${unavailable ? "text-[#8a96b8]" : "text-[#b9c4e6]"}`}>{value}</p></div></div>;
}
