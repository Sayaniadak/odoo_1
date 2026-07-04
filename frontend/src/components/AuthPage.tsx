import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mail, Lock, User, Users, ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';

// Validation schemas matching backend logic exactly
const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email format" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" })
});

const signupSchema = z.object({
  email: z.string().email({ message: "Invalid email format" }),
  password: z.string().optional(),
  full_name: z.string().min(2, { message: "Full name must be at least 2 characters" }),
  role: z.enum(["Employee", "HR", "Admin"], { message: "Invalid role selection" })
});

type LoginFormValues = z.infer<typeof loginSchema>;
type SignupFormValues = z.infer<typeof signupSchema>;

interface AuthPageProps {
  onLoginSuccess: (token: string, refreshToken: string, user: { id: string; email: string; role: string; full_name: string }) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onLoginSuccess }) => {
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Login form hooks
  const { 
    register: registerLogin, 
    handleSubmit: handleLoginSubmit, 
    formState: { errors: loginErrors, isSubmitting: isLoggingIn } 
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema)
  });

  // Signup form hooks
  const { 
    register: registerSignup, 
    handleSubmit: handleSignupSubmit, 
    formState: { errors: signupErrors, isSubmitting: isSigningUp },
    reset: resetSignup
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { role: 'Employee' }
  });

  // Handle Login submission
  const onLogin = async (data: LoginFormValues) => {
    setErrorMessage(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.detail || "Authentication failed.");
      }
      onLoginSuccess(resData.access_token, resData.refresh_token, resData.user);
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  // Handle Signup submission
  const onSignup = async (data: SignupFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    // Auto-generate password
    const generatedPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase() + 'A1!';
    const payload = {
      ...data,
      password: generatedPassword
    };

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.detail || "Registration failed.");
      }
      setSuccessMessage(`Account created — you can sign in now. Copy your temporary password: "${generatedPassword}"`);
      resetSignup();
      setAuthTab('login');
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <div className="logo">
            <i className="fa-solid fa-bolt logo-icon"></i> PulseHR
          </div>
          <p className="subtitle" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Unified HR Management & AI Insights Platform
          </p>
        </div>

        {/* Global Notifications */}
        {errorMessage && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '10px 14px', borderRadius: '8px', color: 'var(--danger)', fontSize: '0.85rem', display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '20px' }}>
            <ShieldAlert size={16} />
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '10px 14px', borderRadius: '8px', color: 'var(--success)', fontSize: '0.85rem', display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '20px' }}>
            <CheckCircle2 size={16} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Tab Selection */}
        <div className="auth-tabs">
          <button 
            className={`auth-tab ${authTab === 'login' ? 'active' : ''}`}
            onClick={() => { setAuthTab('login'); setErrorMessage(null); }}
          >
            Sign In
          </button>
          <button 
            className={`auth-tab ${authTab === 'signup' ? 'active' : ''}`}
            onClick={() => { setAuthTab('signup'); setErrorMessage(null); }}
          >
            Register
          </button>
        </div>

        {/* Login form */}
        {authTab === 'login' && (
          <form onSubmit={handleLoginSubmit(onLogin)}>
            <div className="form-group">
              <label>Email Address</label>
              <div className="input-wrapper">
                <Mail className="input-icon" size={18} />
                <input 
                  type="email" 
                  placeholder="you@company.com" 
                  {...registerLogin("email")}
                />
              </div>
              {loginErrors.email && <span className="field-error">{loginErrors.email.message}</span>}
            </div>

            <div className="form-group">
              <label>Password</label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} />
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  {...registerLogin("password")}
                />
              </div>
              {loginErrors.password && <span className="field-error">{loginErrors.password.message}</span>}
            </div>

            <button type="submit" disabled={isLoggingIn} className="btn btn-primary btn-block">
              {isLoggingIn ? "Signing In..." : (
                <>Sign In <ArrowRight size={16} /></>
              )}
            </button>
          </form>
        )}

        {/* Signup form */}
        {authTab === 'signup' && (
          <form onSubmit={handleSignupSubmit(onSignup)}>
            <div className="form-group">
              <label>Full Name</label>
              <div className="input-wrapper">
                <User className="input-icon" size={18} />
                <input 
                  type="text" 
                  placeholder="Karan Kumar" 
                  {...registerSignup("full_name")}
                />
              </div>
              {signupErrors.full_name && <span className="field-error">{signupErrors.full_name.message}</span>}
            </div>

            <div className="form-group">
              <label>Email Address</label>
              <div className="input-wrapper">
                <Mail className="input-icon" size={18} />
                <input 
                  type="email" 
                  placeholder="you@company.com" 
                  {...registerSignup("email")}
                />
              </div>
              {signupErrors.email && <span className="field-error">{signupErrors.email.message}</span>}
            </div>



            <div className="form-group">
              <label>Role</label>
              <div className="input-wrapper">
                <Users className="input-icon" size={18} />
                <select {...registerSignup("role")}>
                  <option value="Employee">Employee (Normal Access)</option>
                  <option value="HR">HR Specialist</option>
                  <option value="Admin">Administrator (Full Access)</option>
                </select>
              </div>
              {signupErrors.role && <span className="field-error">{signupErrors.role.message}</span>}
            </div>

            <button type="submit" disabled={isSigningUp} className="btn btn-primary btn-block">
              {isSigningUp ? "Registering..." : (
                <>Create Account <CheckCircle2 size={16} /></>
              )}
            </button>
          </form>
        )}

      </div>
    </div>
  );
};
