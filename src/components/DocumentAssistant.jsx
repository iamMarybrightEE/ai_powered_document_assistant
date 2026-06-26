"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import {
  Description,
  Chat,
  Close,
  Visibility,
  VisibilityOff,
  CheckCircle,
  Error,
  HourglassEmpty,
  Send,
} from "@mui/icons-material";

const baseUrl = process.env.NEXT_PUBLIC_DOCUMENT_AGENT_URL || "http://localhost:8100";

function authHeaders() {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("doc_access_token") : null;
  return {
    "Content-Type": "application/json",
    Authorization: token ? `Bearer ${token}` : "Bearer dev-token",
  };
}

function authOnlyHeaders() {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("doc_access_token") : null;
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers.Authorization = "Bearer dev-token";
  }
  return headers;
}

export default function DocumentAssistant({
  documentId = "default-document",
  tenantId = "default",
}) {
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  
  const [indexStatus, setIndexStatus] = useState("PENDING");
  const [sessionId, setSessionId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [chatLoading, setCharLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [documentText, setDocumentText] = useState([]);
  const [documentVisible, setDocumentVisible] = useState(false);
  const [uploadedFilename, setUploadedFilename] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const canChat = indexStatus === "READY";

  const statusTone = useMemo(() => {
    if (indexStatus === "READY") return "success";
    if (indexStatus === "FAILED") return "error";
    return "info";
  }, [indexStatus]);

  const statusIcon = useMemo(() => {
    if (indexStatus === "READY") return <CheckCircle sx={{ fontSize: "1.2rem" }} />;
    if (indexStatus === "FAILED") return <Error sx={{ fontSize: "1.2rem" }} />;
    return <HourglassEmpty sx={{ fontSize: "1.2rem" }} />;
  }, [indexStatus]);

  const refreshStatus = async () => {
    if (!documentId) return;
    try {
      const res = await fetch(
        `${baseUrl}/v1/documents/${documentId}/index/status`,
        { headers: authHeaders() }
      );
      if (!res.ok) return;
      const data = await res.json();
      setIndexStatus(data.status || "PENDING");
    } catch {
      setIndexStatus("PENDING");
    }
  };

  useEffect(() => {
    if (!documentId) return;
    refreshStatus();
    const timer = setInterval(refreshStatus, 7000);
    return () => clearInterval(timer);
  }, [documentId]);

  useEffect(() => {
    if (!documentId || !canChat || sessionId) return;
    const createSession = async () => {
      try {
        const res = await fetch(`${baseUrl}/v1/chat/sessions`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ document_id: documentId, tenant_id: tenantId }),
        });
        if (!res.ok) {
          throw new Error("Failed to initialize chat session");
        }
        const data = await res.json();
        setSessionId(data.session_id);
      } catch (err) {
        setError(err.message || "Failed to initialize chat");
      }
    };
    createSession();
  }, [documentId, tenantId, canChat, sessionId]);

  const runIndexing = async () => {
    const res = await fetch(`${baseUrl}/v1/documents/${documentId}/index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authOnlyHeaders(),
      },
      body: "{}",
    });
    if (!res.ok) {
      let detail = "Indexing failed";
      try {
        const err = await res.json();
        if (typeof err.detail === "string") detail = err.detail;
        else if (Array.isArray(err.detail))
          detail = err.detail.map((e) => e.msg || "").join(" ");
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    await refreshStatus();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !documentId) return;
    setError("");
    setUploading(true);
    setUploadedFilename(file.name);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${baseUrl}/v1/documents/${documentId}/upload`, {
        method: "POST",
        headers: authOnlyHeaders(),
        body: formData,
      });
      if (!res.ok) {
        let detail = "Upload failed";
        try {
          const err = await res.json();
          if (typeof err.detail === "string") detail = err.detail;
          else if (Array.isArray(err.detail))
            detail = err.detail.map((x) => x.msg || "").join(" ");
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      await runIndexing();
      setMessages([]);
      setSessionId("");
      setDocumentVisible(false);
      setSummary(null);
      await generateSummary();
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || !sessionId) return;
    setCharLoading(true);
    setError("");
    
    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    
    const outgoing = chatInput.trim();
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: outgoing }]);
    try {
      const res = await fetch(
        `${baseUrl}/v1/chat/sessions/${sessionId}/messages`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ message: outgoing }),
          signal: abortControllerRef.current.signal,
        }
      );
      if (!res.ok) {
        throw new Error("Failed to get response from chat assistant");
      }
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          citations: data.citations || [],
        },
      ]);
    } catch (err) {
      if (err.name === "AbortError") {
        setError("Chat stopped by user");
      } else {
        setError(err.message || "Could not send message");
      }
    } finally {
      setCharLoading(false);
    }
  };

  const stopChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setCharLoading(false);
    }
  };

  const generateSummary = async () => {
    if (!documentId) return;
    setSummaryLoading(true);
    try {
      const res = await fetch(
        `${baseUrl}/v1/documents/${documentId}/summary`,
        {
          headers: authHeaders(),
        }
      );
      if (!res.ok) {
        throw new Error("Failed to generate summary");
      }
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err.message || "Failed to generate summary");
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadDocumentText = async () => {
    if (!documentId) return;
    setUploading(true);
    setError("");
    try {
      const res = await fetch(
        `${baseUrl}/v1/documents/${documentId}/content`,
        {
          headers: authHeaders(),
        }
      );
      if (!res.ok) {
        throw new Error("Failed to fetch extracted text");
      }
      const data = await res.json();
      const textContent = data.content || "";
      // Split by double newlines to preserve sections but keep them separate
      const sections = textContent
        .split(/\n\n+/)
        .filter((section) => section.trim())
        .map((section) => section.trim());
      setDocumentText(sections);
      setDocumentVisible(true);
    } catch (err) {
      setError(err.message || "Failed to load text");
    } finally {
      setUploading(false);
    }
  };

  const toggleDocumentVisibility = () => {
    if (!documentVisible) {
      loadDocumentText();
    } else {
      setDocumentVisible(false);
    }
  };

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 3,
        background: "linear-gradient(135deg, #ffffff 0%, #fafbfc 100%)",
        border: "1px solid #e8eef7",
        my: 2,
        maxWidth: "800px",
        mx: "auto",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        height: "auto",
        boxShadow: "0 2px 12px rgba(0, 68, 151, 0.04)",
      }}
    >
      <Box sx={{ textAlign: "center", mb: 3 }}>
        <Box
          sx={{
            width: 50,
            height: 50,
            mx: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #004497 0%, #0066cc 100%)",
            borderRadius: "12px",
            mb: 1.5,
          }}
        >
          <Chat sx={{ fontSize: "1.8rem", color: "white" }} />
        </Box>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 700,
            color: "#1a1a1a",
            letterSpacing: "-0.3px",
          }}
        >
          Document Assistant
        </Typography>
        <Typography variant="caption" sx={{ color: "#999", mt: 0.5, display: "block" }}>
          AI-powered document analysis and discussion
        </Typography>
      </Box>

      <Divider sx={{ mb: 3, borderColor: "#e8eef7" }} />

      {/* Upload Section */}
      <Box
        sx={{
          mb: 3,
          p: 2.5,
          border: "2px dashed #d0dce8",
          borderRadius: 2.5,
          textAlign: "center",
          backgroundColor: "#f8fafc",
          cursor: "pointer",
          transition: "all 0.3s ease",
          "&:hover": {
            backgroundColor: "#f0f5fc",
            borderColor: "#004497",
            boxShadow: "0 4px 12px rgba(0, 68, 151, 0.08)",
          },
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          onChange={onFile}
          disabled={uploading}
          style={{ display: "none" }}
        />
        <Box sx={{ display: "flex", justifyContent: "center", mb: 1.5 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#e3f2fd",
              borderRadius: "10px",
            }}
          >
            <Description sx={{ fontSize: "1.5rem", color: "#004497" }} />
          </Box>
        </Box>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, color: "#1a1a1a", mb: 0.5 }}
        >
          {uploading ? "Uploading and indexing..." : uploadedFilename || "Click to upload PDF or DOCX"}
        </Typography>
        {uploadedFilename && !uploading && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
            <CheckCircle sx={{ fontSize: "1rem", color: "#4caf50" }} />
            <Typography variant="caption" sx={{ color: "#666" }}>
              {uploadedFilename}
            </Typography>
          </Box>
        )}
        {!uploadedFilename && (
          <Typography variant="caption" sx={{ color: "#999" }}>
            Maximum 1MB
          </Typography>
        )}
        {uploading && <CircularProgress size={20} sx={{ mt: 1, color: "#004497" }} />}
      </Box>
      <Alert
        severity={statusTone}
        icon={statusIcon}
        sx={{
          mb: 2,
          borderRadius: 2,
          border: "1px solid",
          borderColor:
            statusTone === "success"
              ? "#4caf50"
              : statusTone === "error"
              ? "#f44336"
              : "#2196f3",
          backgroundColor:
            statusTone === "success"
              ? "#f1f8e9"
              : statusTone === "error"
              ? "#fee"
              : "#e3f2fd",
          "& .MuiAlert-message": {
            width: "100%",
            textAlign: "left",
            fontSize: "0.95rem",
          },
        }}
      >
        <strong>Status:</strong> {indexStatus}
        <Box sx={{ fontSize: "0.85rem", mt: 0.5, color: "text.secondary" }}>
          {!canChat
            ? "Waiting for document upload and indexing..."
            : "Ready to chat about your document"}
        </Box>
      </Alert>

      

      {/* Document Analysis Section */}
      {canChat && summary && (
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            mb: 3,
            bgcolor: "linear-gradient(135deg, #f0f5fc 0%, #f8fafd 100%)",
            border: "1px solid #d4e3f7",
            borderRadius: 2.5,
            boxShadow: "0 2px 8px rgba(0, 68, 151, 0.06)",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#004497",
                borderRadius: "6px",
                mr: 1,
                fontSize: "0.8rem",
              }}
            >
              <Description sx={{ fontSize: "1rem", color: "white" }} />
            </Box>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                color: "#004497",
              }}
            >
              Document Analysis
            </Typography>
          </Box>
          
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="caption" sx={{ color: "#999", fontWeight: 600, textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.5px" }}>
                Title
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: "#1a1a1a", mt: 0.5 }}>
                {summary.title || "—"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" sx={{ color: "#999", fontWeight: 600, textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.5px" }}>
                Author
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: "#1a1a1a", mt: 0.5 }}>
                {summary.author || "—"}
              </Typography>
            </Box>
          </Box>
          
          <Divider sx={{ my: 1.5, borderColor: "#d4e3f7" }} />
          
          <Box>
            <Typography variant="caption" sx={{ color: "#999", fontWeight: 600, textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.5px" }}>
              Main Content
            </Typography>
            <Typography variant="body2" sx={{ color: "#555", lineHeight: 1.7, mt: 0.8 }}>
              {summary.summary || "Unable to generate summary"}
            </Typography>
          </Box>
        </Paper>
      )}

      {/* Summary Loading */}
      {summaryLoading && (
        <Alert severity="info" sx={{ mb: 3, borderRadius: 2.5, backgroundColor: "#e3f2fd", borderColor: "#90caf9" }}>
          Generating document analysis...
        </Alert>
      )}

      {/* View Document Button */}
      {canChat && (
        <>
          <Box sx={{ display: "flex", gap: 1, mb: 3 }}>
            <Button
              variant={documentVisible ? "contained" : "outlined"}
              onClick={toggleDocumentVisibility}
              disabled={uploading}
              startIcon={
                documentVisible ? (
                  <VisibilityOff />
                ) : (
                  <Visibility />
                )
              }
              size="small"
              sx={{
                borderRadius: 2,
                textTransform: "none",
                fontWeight: 600,
                transition: "all 0.3s ease",
                fontSize: "0.875rem",
                ...(documentVisible
                  ? {
                      background: "linear-gradient(135deg, #004497 0%, #0066cc 100%)",
                      color: "#ffffff",
                      borderColor: "transparent",
                      boxShadow: "0 2px 8px rgba(0, 68, 151, 0.25)",
                    }
                  : {
                      borderColor: "#d0dce8",
                      color: "#004497",
                      backgroundColor: "#ffffff",
                    }),
              }}
            >
              {documentVisible ? "Hide Text" : "View Text"}
            </Button>

            {!summary && !summaryLoading && (
              <Button
                variant="outlined"
                onClick={generateSummary}
                disabled={uploading}
                size="small"
                sx={{
                  borderRadius: 2,
                  textTransform: "none",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  borderColor: "#d0dce8",
                  color: "#004497",
                  backgroundColor: "#ffffff",
                  transition: "all 0.2s ease",
                  "&:hover": {
                    borderColor: "#004497",
                    backgroundColor: "#f8fafc",
                  },
                }}
              >
                Generate Analysis
              </Button>
            )}
          </Box>

          <Divider sx={{ my: 3, borderColor: "#e8eef7" }} />
          <Typography variant="caption" sx={{ color: "#999", display: "block", mb: 2, textAlign: "center", fontWeight: 600, letterSpacing: "0.5px" }}>
            CONVERSATION
          </Typography>
        </>
      )}

      {/* Document Content */}
      {documentVisible && documentText.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            mb: 3,
            maxHeight: 320,
            overflowY: "auto",
            bgcolor: "#fafbfc",
            border: "1px solid #e8eef7",
            borderRadius: 2.5,
            position: "relative",
            boxShadow: "inset 0 1px 3px rgba(0, 0, 0, 0.02)",
          }}
        >
          <Box
            onClick={() => setDocumentVisible(false)}
            sx={{
              position: "absolute",
              top: 8,
              right: 8,
              cursor: "pointer",
              opacity: 0.6,
              transition: "all 0.2s ease",
              "&:hover": {
                opacity: 1,
                transform: "scale(1.1)",
              },
            }}
          >
            <Close />
          </Box>
          <Typography
            variant="caption"
            sx={{
              display: "block",
              mb: 1.5,
              fontWeight: 600,
              color: "#333",
              fontSize: "0.85rem",
              paddingRight: 2,
            }}
          >
            Document Text
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {documentText.map((section, idx) => (
              <Box key={idx}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {section}
                </Typography>
                {idx < documentText.length - 1 && <Divider sx={{ mt: 1.5 }} />}
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* Chat Messages */}
      <Box
        sx={{
          mb: 3,
          maxHeight: 420,
          overflowY: "auto",
          p: 1.5,
          bgcolor: "transparent",
          borderRadius: 2.5,
          display: "flex",
          flexDirection: "column",
          gap: 1.2,
        }}
      >
        {messages.length === 0 && !chatLoading && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", py: 4, fontSize: "0.9rem" }}
          >
            {canChat
              ? "Start your conversation..."
              : "Upload a document to begin chatting"}
          </Typography>
        )}
        {messages.map((m, idx) => (
          <Box
            key={`${m.role}-${idx}`}
            sx={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <Paper
              sx={{
                p: 1.3,
                maxWidth: "80%",
                bgcolor: m.role === "user" ? "#e3f2fd" : "#f0f4f9",
                border: "none",
                borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
              }}
              elevation={0}
            >
              <Typography variant="body2" sx={{ wordBreak: "break-word", lineHeight: 1.5 }}>
                {m.content}
              </Typography>
              {m.citations?.length > 0 && (
                <>
                  <Divider sx={{ my: 0.8, opacity: 0.3 }} />
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: "0.7rem",
                      opacity: 0.6,
                      display: "block",
                    }}
                  >
                    {m.citations.length} source{m.citations.length > 1 ? "s" : ""}
                  </Typography>
                </>
              )}
            </Paper>
          </Box>
        ))}
        {chatLoading && (
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-start",
            }}
          >
            <Paper
              sx={{
                p: 1.2,
                maxWidth: "80%",
                bgcolor: "#f5f5f5",
                border: "none",
                borderRadius: "16px 16px 16px 4px",
              }}
              elevation={0}
            >
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", minHeight: "20px" }}>
                <CircularProgress size={14} sx={{ color: "#004497" }} />
                <Typography variant="caption" sx={{ color: "#666" }}>
                  Thinking...
                </Typography>
              </Box>
            </Paper>
          </Box>
        )}
      </Box>

      {/* Chat Input */}
      <Box sx={{ display: "flex", gap: 0.75, alignItems: "flex-end" }}>
        <TextField
          fullWidth
          size="small"
          disabled={!canChat || !sessionId}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !chatLoading) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={
            canChat
              ? "Message Document Assistant..."
              : "Upload a document to chat"
          }
          multiline
          maxRows={4}
          variant="outlined"
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 2.5,
              backgroundColor: "#ffffff",
              transition: "all 0.3s ease",
              border: "1px solid #d0dce8",
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.04)",
              "&:hover": {
                backgroundColor: "#ffffff",
                borderColor: "#0066cc",
                boxShadow: "0 2px 8px rgba(0, 68, 151, 0.1)",
              },
              "&.Mui-focused": {
                backgroundColor: "#ffffff",
                boxShadow: "0 2px 12px rgba(0, 68, 151, 0.15)",
                "& fieldset": {
                  borderColor: "#0066cc",
                },
              },
            },
            "& .MuiOutlinedInput-input::placeholder": {
              color: "#bbb",
              opacity: 1,
            },
          }}
        />
        {/* Upload Button in Chat Input */}
        <Button
          component="label"
          disabled={!canChat || !sessionId || uploading}
          sx={{
            borderRadius: "50%",
            minWidth: 44,
            width: 44,
            height: 44,
            p: 0,
            backgroundColor: "#f0f4f9",
            border: "1px solid #d0dce8",
            color: "#004497",
            transition: "all 0.2s ease",
            "&:hover:not(:disabled)": {
              backgroundColor: "#e3f2fd",
              borderColor: "#004497",
              boxShadow: "0 2px 8px rgba(0, 68, 151, 0.2)",
            },
            "&:disabled": {
              opacity: 0.5,
              cursor: "not-allowed",
            },
          }}
          title="Attach document"
        >
          <input
            type="file"
            accept=".pdf,.docx"
            onChange={onFile}
            style={{ display: "none" }}
          />
          <Description sx={{ fontSize: "1.1rem" }} />
        </Button>
        {!chatLoading ? (
          <Button
            variant="contained"
            disabled={!canChat || !chatInput.trim() || !sessionId}
            onClick={sendMessage}
            sx={{
              borderRadius: "50%",
              minWidth: 44,
              width: 44,
              height: 44,
              p: 0,
              background: !chatInput.trim() || !canChat || !sessionId
                ? "#d0d0d0"
                : "linear-gradient(135deg, #004497 0%, #0066cc 100%)",
              transition: "all 0.3s ease",
              border: "none",
              "&:hover:not(:disabled)": {
                transform: "scale(1.08)",
                boxShadow: "0 4px 16px rgba(0, 68, 151, 0.35)",
              },
              "&:disabled": {
                opacity: 0.5,
              },
            }}
          >
            <Send sx={{ fontSize: "1.1rem", color: "white" }} />
          </Button>
        ) : (
          <Box sx={{ display: "flex", gap: 0.75 }}>
            <Button
              variant="contained"
              disabled={!chatLoading}
              onClick={stopChat}
              sx={{
                borderRadius: "50%",
                minWidth: 44,
                width: 44,
                height: 44,
                p: 0,
                background: "linear-gradient(135deg, #7c8fa3 0%, #6b7d96 100%)",
                transition: "all 0.3s ease",
                border: "none",
                "&:hover": {
                  transform: "scale(1.08)",
                  boxShadow: "0 4px 16px rgba(123, 143, 163, 0.3)",
                },
              }}
              title="Stop chat"
            >
              <Close sx={{ fontSize: "1.1rem", color: "white" }} />
            </Button>
          </Box>
        )}
      </Box>
    </Paper>
  );
}
