import { cn } from "@/lib/utils"

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[22%] bg-[#1a1f29] shadow-sm ring-1 ring-black/10", className)}>
      <svg viewBox="100 100 824 824" className="block size-full" aria-hidden="true">
        <path
          fill="#f3efe6"
          d="M250 1000 C270 860 300 720 330 560 C350 380 450 280 580 280 C660 280 712 316 734 360 C790 360 840 400 842 452 C843 478 830 488 822 474 C812 452 790 444 770 446 C756 448 744 452 734 458 C724 520 712 560 712 600 C720 700 760 860 820 1000 Z"
        />
        <path
          fill="#e2703a"
          stroke="#e2703a"
          strokeWidth="5"
          d="M250 1000 C270 860 300 720 330 560 C340 500 356 450 380 410 C396 520 420 620 470 720 C500 800 510 900 520 1000 Z"
        />
        <path fill="#3b4352" d="M734 360 C790 360 840 400 842 452 C843 478 830 488 822 474 C812 452 790 444 770 446 C756 448 744 452 734 458 C728 430 728 390 734 360 Z" />
        <path fill="#f2b33d" d="M722 350 C740 340 762 346 768 364 C756 374 738 378 726 376 Z" />
        <path fill="#161b24" d="M604 432 C594 482 598 522 616 558 C632 522 640 480 642 442 Z" />
        <circle cx="628" cy="400" r="42" fill="#f2b33d" />
        <circle cx="628" cy="400" r="28" fill="#161b24" />
        <circle cx="638" cy="390" r="8" fill="#f3efe6" />
      </svg>
    </div>
  )
}
