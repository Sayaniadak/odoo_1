"""
HRMS Backend — Payroll Router

Endpoints:
  POST /api/payroll                      — Create payroll record (Admin only)
  GET  /api/payroll                      — View payroll records (Admin: all, Employee: own)
  GET  /api/payroll/{payroll_id}/download — Download PDF payslip (Admin or Owner Employee)
"""

from datetime import datetime
import io
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from supabase import Client

# ReportLab imports for premium PDF generation
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from backend.app.auth import get_current_user, require_role, security, CurrentUser
from backend.app.database import get_supabase_client

router = APIRouter(prefix="/api/payroll", tags=["Payroll"])


def get_db(creds=Depends(security)) -> Client:
    return get_supabase_client(creds.credentials)


# ── Models ───────────────────────────────────────────────────────────────────

class PayrollCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    month: str = Field(..., description="Month in YYYY-MM format")
    base_salary: float
    deductions: float = 0.0
    user_id: str

    @field_validator("month")
    @classmethod
    def validate_month(cls, v):
        if not re.match(r"^\d{4}-\d{2}$", v):
            raise ValueError("Month must be in YYYY-MM format (e.g. 2026-07)")
        parts = v.split("-")
        m = int(parts[1])
        if m < 1 or m > 12:
            raise ValueError("Month must be between 01 and 12")
        return v


class PayrollUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_salary: Optional[float] = None
    deductions: Optional[float] = None
    month: Optional[str] = None

    @field_validator("month")
    @classmethod
    def validate_month(cls, v):
        if v is None:
            return v
        if not re.match(r"^\d{4}-\d{2}$", v):
            raise ValueError("Month must be in YYYY-MM format (e.g. 2026-07)")
        parts = v.split("-")
        m = int(parts[1])
        if m < 1 or m > 12:
            raise ValueError("Month must be between 01 and 12")
        return v


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("", summary="Create a payroll record (Admin only)")
async def create_payroll(
    data: PayrollCreate,
    _: CurrentUser = Depends(require_role("Admin")),
    db: Client = Depends(get_db)
):
    year, month = map(int, data.month.split("-"))
    
    # Calculate net_pay for internal validation/logging
    net_pay = data.base_salary - data.deductions
    if net_pay < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deductions cannot exceed base salary."
        )

    # Insert into database
    try:
        resp = db.table("payroll").insert({
            "user_id": data.user_id,
            "base_salary": data.base_salary,
            "deductions": data.deductions,
            "month": month,
            "year": year
        }).execute()
        return {"message": "Payroll record created successfully", "data": resp.data[0]}
    except Exception as e:
        # Wrap database constraint/foreign key failures in HTTP 400
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Database error creating payroll record: {str(e)}"
        )


@router.get("", summary="Get payroll records")
async def get_payroll(
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    query = db.table("payroll").select("*")
    if user.role in ("Employee", "HR"):
        query = query.eq("user_id", user.id)
        
    resp = query.order("year", desc=True).order("month", desc=True).execute()
    records = resp.data
    
    # Enrich records with profile information using a second query (avoiding relationship cache error)
    if records:
        user_ids = list(set(r["user_id"] for r in records))
        prof_resp = db.table("profiles").select("user_id, full_name, department").in_("user_id", user_ids).execute()
        prof_map = {p["user_id"]: p for p in prof_resp.data}
        for r in records:
            r["profiles"] = prof_map.get(r["user_id"])
            
    return records


@router.get("/{payroll_id}/download", summary="Download payslip PDF")
async def download_payslip(
    payroll_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Client = Depends(get_db)
):
    # Retrieve payroll record
    payroll_resp = db.table("payroll").select("*").eq("id", payroll_id).execute()
    if not payroll_resp.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Payroll record not found.")
        
    payroll = payroll_resp.data[0]
    
    # Security: Employees can only view/download their own payslip
    if user.role == "Employee" and payroll["user_id"] != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view this payroll record."
        )

    # Fetch profile details separately
    profile_resp = db.table("profiles").select("full_name, department, job_title").eq("user_id", payroll["user_id"]).execute()
    profile = profile_resp.data[0] if profile_resp.data else {}

    # ── ReportLab PDF Generation ──────────────────────────────────────────────
    
    buffer = io.BytesIO()
    
    # Page setup
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=54,
        leftMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    
    story = []
    styles = getSampleStyleSheet()
    
    # Premium Color Palette
    primary_color = colors.HexColor("#1e293b")  # Slate 800
    accent_color = colors.HexColor("#3b82f6")   # Blue 500
    text_dark = colors.HexColor("#0f172a")      # Slate 900
    text_muted = colors.HexColor("#64748b")     # Slate 500
    bg_light = colors.HexColor("#f8fafc")       # Slate 50
    border_color = colors.HexColor("#e2e8f0")   # Slate 200
    
    # Custom Typography Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=26,
        leading=30,
        textColor=primary_color
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=text_muted
    )
    
    h2_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=primary_color
    )
    
    body_style = ParagraphStyle(
        'BodyTextCustom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=text_dark
    )
    
    body_bold = ParagraphStyle(
        'BodyBoldCustom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=14,
        textColor=text_dark
    )
    
    header_right = ParagraphStyle(
        'HeaderRight',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=accent_color,
        alignment=2  # Right
    )

    # 1. Header Section
    story.append(Paragraph("PulseHR", title_style))
    story.append(Paragraph("Unified HR Management & Payroll Platform", subtitle_style))
    story.append(Spacer(1, 15))
    
    # Horizontal rule
    hr_table = Table([[""]], colWidths=[504], rowHeights=[2])
    hr_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), accent_color),
        ('PADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(hr_table)
    story.append(Spacer(1, 20))
    
    # 2. Payslip Details (Employee info & Metadata)
    month_name = datetime(2000, payroll["month"], 1).strftime("%B")
    payslip_period = f"{month_name} {payroll['year']}"
    
    meta_data = [
        [
            Paragraph("<b>Employee Name:</b>", body_style),
            Paragraph(str(profile.get("full_name") or "N/A"), body_style),
            Paragraph("<b>Payslip Period:</b>", body_style),
            Paragraph(payslip_period, body_style)
        ],
        [
            Paragraph("<b>Department:</b>", body_style),
            Paragraph(str(profile.get("department") or "N/A"), body_style),
            Paragraph("<b>Payment Date:</b>", body_style),
            Paragraph(datetime.now().strftime("%Y-%m-%d"), body_style)
        ],
        [
            Paragraph("<b>Job Title:</b>", body_style),
            Paragraph(str(profile.get("job_title") or "N/A"), body_style),
            Paragraph("<b>Statement ID:</b>", body_style),
            Paragraph(str(payroll["id"])[:8].upper(), body_style)
        ]
    ]
    
    meta_table = Table(meta_data, colWidths=[100, 152, 100, 152])
    meta_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('PADDING', (0,0), (-1,-1), 6),
        ('BACKGROUND', (0,0), (-1,-1), bg_light),
        ('BOX', (0,0), (-1,-1), 1, border_color),
        ('INNERGRID', (0,0), (-1,-1), 0.5, border_color),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 30))
    
    # 3. Earnings & Deductions Breakdowns
    story.append(Paragraph("Salary Breakdown", h2_style))
    story.append(Spacer(1, 8))
    
    breakdown_data = [
        [Paragraph("Description", body_bold), Paragraph("Amount", body_bold)],
        [Paragraph("Basic Salary", body_style), Paragraph(f"${payroll['base_salary']:,.2f}", body_style)],
        [Paragraph("Deductions (Tax, PF, Unpaid Leave)", body_style), Paragraph(f"-${payroll['deductions']:,.2f}", body_style)],
        [Paragraph("<b>Net Pay (Take-home)</b>", body_bold), Paragraph(f"<b>${payroll['net_pay']:,.2f}</b>", body_bold)]
    ]
    
    breakdown_table = Table(breakdown_data, colWidths=[384, 120])
    breakdown_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('PADDING', (0,0), (-1,-1), 8),
        ('BACKGROUND', (0,0), (-1,0), border_color),
        ('BACKGROUND', (0,3), (-1,3), bg_light),
        ('LINEBELOW', (0,0), (-1,0), 1, primary_color),
        ('LINEBELOW', (0,1), (-1,1), 0.5, border_color),
        ('LINEBELOW', (0,2), (-1,2), 1, primary_color),
        ('BOX', (0,0), (-1,-1), 1, border_color),
    ]))
    story.append(breakdown_table)
    story.append(Spacer(1, 40))
    
    # 4. Footer & Signature Placeholder
    footer_text = (
        "This is a system-generated payslip and does not require a physical signature. "
        "For any inquiries regarding your payment or tax deductions, please reach out to the HR department."
    )
    story.append(Paragraph(footer_text, subtitle_style))
    
    doc.build(story)
    
    buffer.seek(0)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    
    # Return as response
    headers = {
        "Content-Disposition": f"attachment; filename=payslip_{payroll['year']}_{payroll['month']}.pdf"
    }
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers=headers
    )
